// Read-only export of a full event (event settings, games, players, tables) to a local JSON file,
// for use as a realistic local test fixture (e.g. feeding scripts/simulate-generation.mts) without
// touching production data. Never commit the output — /backups is gitignored (player PII inside:
// names, phone, email).
//
// Usage: node scripts/backup-event.mjs <eventCode>
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
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
  console.error('Usage: node scripts/backup-event.mjs <eventCode>');
  process.exit(1);
}

const eventDoc = await db.collection('events').doc(eventCode).get();
if (!eventDoc.exists) { console.error('Event not found:', eventCode); process.exit(1); }

function serialize(data) {
  // Firestore Timestamps aren't plain-JSON-serializable — convert to ISO strings.
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = v && typeof v.toDate === 'function' ? v.toDate().toISOString() : v;
  }
  return out;
}

const [gamesSnap, playersSnap, tablesSnap] = await Promise.all([
  db.collection('events').doc(eventCode).collection('games').get(),
  db.collection('events').doc(eventCode).collection('players').get(),
  db.collection('events').doc(eventCode).collection('tables').get(),
]);

const backup = {
  exportedAt: new Date().toISOString(),
  eventCode,
  event: serialize(eventDoc.data()),
  games: gamesSnap.docs.map((d) => ({ id: d.id, ...serialize(d.data()) })),
  players: playersSnap.docs.map((d) => ({ id: d.id, ...serialize(d.data()) })),
  tables: tablesSnap.docs.map((d) => ({ id: d.id, ...serialize(d.data()) })),
};

mkdirSync(new URL('../backups', import.meta.url), { recursive: true });
const outPath = new URL(`../backups/${eventCode}-${backup.event.date}.json`, import.meta.url);
writeFileSync(outPath, JSON.stringify(backup, null, 2));

console.log(`Backed up ${backup.games.length} games, ${backup.players.length} players, ${backup.tables.length} tables.`);
console.log('Saved to:', outPath.pathname);
