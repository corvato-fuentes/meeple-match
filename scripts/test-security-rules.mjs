// End-to-end check of the Firestore security rules (firestore.rules) against the live project.
//
//   node scripts/test-security-rules.mjs
//
// It creates a throwaway event (ZZSEC) with the Admin SDK, then talks to Firestore the way the website does — with the
// browser SDK, signed out / as a player / as the event admin (same custom tokens the /api/auth routes mint) — and checks
// what each of them may and may not do. The throwaway event is deleted at the end. Reads FIREBASE_* from .env.local.
//
// Run it AFTER publishing new rules (and before, to see which checks the old rules would have failed).
import { readFileSync } from 'fs';
import { initializeApp as initAdmin, cert } from 'firebase-admin/app';
import { getFirestore as adminFirestore } from 'firebase-admin/firestore';
import { getAuth as adminAuth } from 'firebase-admin/auth';
import { initializeApp as initClient } from 'firebase/app';
import { getAuth, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, doc, getDoc, deleteDoc, updateDoc, setDoc } from 'firebase/firestore';

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf-8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}

initAdmin({ credential: cert(JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf-8'))) });
const admin = adminFirestore();
const CODE = 'ZZSEC';
const OTHER = 'ZZSEC2';
const ev = admin.collection('events').doc(CODE);

const clientConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY, authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

/** A browser-like client, optionally signed in with a custom token (what the /api/auth routes hand out). */
async function client(name, claims) {
  const app = initClient(clientConfig, name);
  const db = getFirestore(app);
  if (claims) {
    const { uid, extra } = claims;
    await signInWithCustomToken(getAuth(app), await adminAuth().createCustomToken(uid, extra));
  }
  return db;
}

let failed = 0;
async function check(label, expected, run) {
  let outcome;
  try { await run(); outcome = 'allow'; }
  catch (err) { outcome = /permission|PERMISSION/.test(String(err?.code ?? err)) ? 'deny' : `error(${err?.code ?? err})`; }
  const ok = outcome === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}  [${expected}${ok ? '' : ` — got ${outcome}`}]`);
}

async function seed() {
  await ev.set({ name: 'Security test', date: '2027-01-01', startTime: '10:00', endTime: '18:00', location: 'x', mapUrl: null,
    settings: { bufferMinutes: 10, physicalTables: null, breaks: [], maxPlayers: null, maxGamesPerPlayer: null, paymentRequired: false, paymentInfo: null, registrationBannerUrl: null } });
  await ev.collection('private').doc('config').set({ adminToken: 'ZZ-TEST-TOKEN' });
  for (const id of ['p1', 'p2', 'p3', 'p4', 'p5']) await ev.collection('players').doc(id).set({ name: id, ticketCode: 'T' + id, interests: {} });
  await ev.collection('games').doc('g1').set({ name: 'G1', ownerPlayerId: 'p1' });
  await ev.collection('games').doc('g2').set({ name: 'G2', ownerPlayerId: 'p2' });
  await ev.collection('games').doc('g3').set({ name: 'G3', ownerPlayerId: 'p1' });
  await ev.collection('games').doc('g4').set({ name: 'G4', ownerPlayerId: 'p2' });
  const t = (id, o) => ev.collection('tables').doc(id).set({ gameId: 'g1', gameName: 'G1', startTime: '08:00', endTime: '09:00', explainerId: 'p1', playerIds: [], status: 'recommended', ...o });
  await t('stale', {});
  await t('stale2', {});
  await t('inside', { startTime: '11:00', endTime: '12:00' });
  await t('lateEnd', { startTime: '17:00', endTime: '19:00' });
  await t('confirmed', { status: 'confirmed' });
  await t('posted', { postedByOwner: true });
  await t('forUpdate', { startTime: '11:00', endTime: '12:00' });
  await t('adminTable', { status: 'confirmed', startTime: '11:00', endTime: '12:00' });
  await admin.collection('mathtrades').doc(CODE).set({ name: 'mt', status: 'open' });
  await admin.collection('mathtrades').doc(CODE).collection('private').doc('config').set({ adminToken: 'ZZ-MT-TOKEN' });
}

try {
  await seed();
  const anon = await client('anon');
  const p1 = await client('p1', { uid: `player:${CODE}:p1`, extra: { playerFor: CODE, playerId: 'p1' } });
  const p2 = await client('p2', { uid: `player:${CODE}:p2`, extra: { playerFor: CODE, playerId: 'p2' } });
  const pOther = await client('pOther', { uid: `player:${OTHER}:p1`, extra: { playerFor: OTHER, playerId: 'p1' } });
  const adm = await client('adm', { uid: `admin:${CODE}`, extra: { adminFor: CODE } });
  const admOther = await client('admOther', { uid: `admin:${OTHER}`, extra: { adminFor: OTHER } });
  const d = (db, ...path) => doc(db, ...path);

  console.log('\n— The admin token is private');
  await check('signed out cannot read the event admin token', 'deny', () => getDoc(d(anon, 'events', CODE, 'private', 'config')));
  await check('a player cannot read it', 'deny', () => getDoc(d(p1, 'events', CODE, 'private', 'config')));
  await check('even the admin cannot read it from a browser', 'deny', () => getDoc(d(adm, 'events', CODE, 'private', 'config')));
  await check('math trade token is private too', 'deny', () => getDoc(d(anon, 'mathtrades', CODE, 'private', 'config')));
  await check('public data stays readable (event)', 'allow', () => getDoc(d(anon, 'events', CODE)));
  await check('public data stays readable (players)', 'allow', () => getDoc(d(anon, 'events', CODE, 'players', 'p1')));

  console.log('\n— Editing the event');
  await check('signed out cannot change the date', 'deny', () => updateDoc(d(anon, 'events', CODE), { date: '2000-01-01' }));
  await check('a player cannot change the date', 'deny', () => updateDoc(d(p1, 'events', CODE), { date: '2000-01-01' }));
  await check('admin of ANOTHER event cannot', 'deny', () => updateDoc(d(admOther, 'events', CODE), { date: '2000-01-01' }));
  await check('the admin can edit the event', 'allow', () => updateDoc(d(adm, 'events', CODE), { name: 'Security test (edited)' }));
  await check('anyone can take the generation lock', 'allow', () => updateDoc(d(anon, 'events', CODE), { genLockAt: Date.now() }));
  await check('anyone can release it (null)', 'allow', () => updateDoc(d(anon, 'events', CODE), { genLockAt: null }));
  await check('the lock cannot be parked far in the future', 'deny', () => updateDoc(d(anon, 'events', CODE), { genLockAt: Date.now() + 10 * 24 * 3600 * 1000 }));
  await check('the lock cannot carry another field', 'deny', () => updateDoc(d(anon, 'events', CODE), { genLockAt: Date.now(), date: '2000-01-01' }));
  await check('nobody can delete the event (not even the admin)', 'deny', () => deleteDoc(d(adm, 'events', CODE)));

  console.log('\n— Deleting games');
  await check('signed out cannot delete a game', 'deny', () => deleteDoc(d(anon, 'events', CODE, 'games', 'g1')));
  await check('another player cannot delete it', 'deny', () => deleteDoc(d(p2, 'events', CODE, 'games', 'g1')));
  await check('a player of another event cannot', 'deny', () => deleteDoc(d(pOther, 'events', CODE, 'games', 'g1')));
  await check('the owner can delete their own game', 'allow', () => deleteDoc(d(p1, 'events', CODE, 'games', 'g1')));
  await check('admin of another event cannot delete a game', 'deny', () => deleteDoc(d(admOther, 'events', CODE, 'games', 'g2')));
  await check('the admin can delete any game', 'allow', () => deleteDoc(d(adm, 'events', CODE, 'games', 'g2')));

  console.log('\n— Deleting players');
  await check('signed out cannot delete a player', 'deny', () => deleteDoc(d(anon, 'events', CODE, 'players', 'p3')));
  await check('a player cannot delete anyone, themselves included', 'deny', () => deleteDoc(d(p1, 'events', CODE, 'players', 'p1')));
  await check('the admin can delete a player', 'allow', () => deleteDoc(d(adm, 'events', CODE, 'players', 'p3')));

  console.log('\n— Deleting tables');
  await check('signed out cannot delete a stale table', 'deny', () => deleteDoc(d(anon, 'events', CODE, 'tables', 'stale')));
  await check('a player can prune a stale recommended table', 'allow', () => deleteDoc(d(p1, 'events', CODE, 'tables', 'stale')));
  await check('…also one that runs past the event end', 'allow', () => deleteDoc(d(p1, 'events', CODE, 'tables', 'lateEnd')));
  await check('a player cannot delete a table inside the schedule', 'deny', () => deleteDoc(d(p1, 'events', CODE, 'tables', 'inside')));
  await check('a player cannot delete a confirmed table', 'deny', () => deleteDoc(d(p1, 'events', CODE, 'tables', 'confirmed')));
  await check('a player cannot delete an owner-posted table', 'deny', () => deleteDoc(d(p1, 'events', CODE, 'tables', 'posted')));
  await check('a player of another event cannot prune', 'deny', () => deleteDoc(d(pOther, 'events', CODE, 'tables', 'stale2')));
  await check('the admin can delete any table', 'allow', () => deleteDoc(d(adm, 'events', CODE, 'tables', 'adminTable')));

  console.log('\n— What must keep working for everyone');
  await check('create a game', 'allow', () => setDoc(d(anon, 'events', CODE, 'games', 'new'), { name: 'new', ownerPlayerId: 'p4' }));
  await check('update a player (votes, times…)', 'allow', () => updateDoc(d(anon, 'events', CODE, 'players', 'p4'), { interests: { g4: 'yes' } }));
  await check('update a table (accept / join)', 'allow', () => updateDoc(d(anon, 'events', CODE, 'tables', 'forUpdate'), { playerIds: ['p4'] }));
} finally {
  await admin.recursiveDelete(ev);
  await admin.recursiveDelete(admin.collection('mathtrades').doc(CODE));
  console.log('\ncleaned up the test event');
}
console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
