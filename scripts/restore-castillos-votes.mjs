// One-off data repair: restores votes for "The Castles of Burgundy" (the surviving copy owned by
// Emmanuel Fuentes) after its merge-group primary ("Los Castillos de Borgoña") was deleted by its
// owner, which wiped every player's vote on the merged game and orphaned this copy's groupId.
// Un-orphans the copy (promotes it to standalone/primary) and re-applies the votes/explainer flags
// the admin reconstructed from memory. Writes directly via the Admin SDK (bypasses Firestore rules).
//
// Usage: node scripts/restore-castillos-votes.mjs <eventCode>
import { readFileSync } from 'fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const envText = readFileSync(new URL('../.env.local', import.meta.url), 'utf-8');
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const serviceAccount = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf-8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const [, , eventCode] = process.argv;
if (!eventCode) {
  console.error('Usage: node scripts/restore-castillos-votes.mjs <eventCode>');
  process.exit(1);
}

const GAME_ID = 'hD6w3bwXh3dheYF0tjHe'; // "The Castles of Burgundy", owner Emmanuel Fuentes
const MUST = ['Emmanuel Fuentes', 'Alejo Albert', 'Nois', 'Genaro Verdecchia', 'Max C.', 'Cris'];
const CASUAL_AND_EXPLAINS = ['Nicolas Tosoroni'];
const EXPLAIN_ONLY = ['Emmanuel Fuentes', 'Emi']; // teach-capable; Emmanuel is also in MUST above

const gameRef = db.collection('events').doc(eventCode).collection('games').doc(GAME_ID);
const gameSnap = await gameRef.get();
if (!gameSnap.exists) { console.error('Game not found:', GAME_ID); process.exit(1); }
const game = gameSnap.data();
console.log(`Game: ${game.name} (owner=${game.ownerName}, current groupId=${game.groupId ?? 'null'})`);

const playersSnap = await db.collection('events').doc(eventCode).collection('players').get();
const byName = new Map(playersSnap.docs.map((d) => [d.data().name, { id: d.id, ...d.data() }]));

const allNames = [...new Set([...MUST, ...CASUAL_AND_EXPLAINS, ...EXPLAIN_ONLY])];
const missing = allNames.filter((n) => !byName.has(n));
if (missing.length > 0) { console.error('Players not found, aborting:', missing); process.exit(1); }

const batch = db.batch();

// Un-orphan the copy: it becomes standalone (no more merge group) since the primary is gone.
batch.update(gameRef, { groupId: null });

function applyVote(name, vote) {
  const p = byName.get(name);
  const ref = db.collection('events').doc(eventCode).collection('players').doc(p.id);
  const interests = { ...(p.interests ?? {}), [GAME_ID]: vote };
  batch.update(ref, { interests });
}

function applyCanExplain(name) {
  const p = byName.get(name);
  const ref = db.collection('events').doc(eventCode).collection('players').doc(p.id);
  const canExplain = new Set(p.canExplain ?? []);
  canExplain.add(GAME_ID);
  batch.update(ref, { canExplain: [...canExplain] });
}

for (const name of MUST) applyVote(name, 'must');
for (const name of CASUAL_AND_EXPLAINS) { applyVote(name, 'casual'); applyCanExplain(name); }
for (const name of EXPLAIN_ONLY) applyCanExplain(name);

await batch.commit();

console.log('\nDone. Restored:');
console.log('  must:', MUST.join(', '));
console.log('  casual + explica:', CASUAL_AND_EXPLAINS.join(', '));
console.log('  explica (sin voto propio):', EXPLAIN_ONLY.filter((n) => !MUST.includes(n)).join(', '));
console.log('\nAhora generá las mesas de nuevo desde el panel admin ("Generar mesas") para que se agende.');
