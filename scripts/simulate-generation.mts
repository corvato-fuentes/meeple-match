// Read-only dry-run of generateTables() against live Firestore data — never writes anything back.
// Lets us check "would game X get a table with the current code" without touching production.
//
// Usage: npx tsx scripts/simulate-generation.ts <eventCode>
import { readFileSync } from 'fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { generateTables } from '../src/lib/tableAlgorithm';

const envText = readFileSync(new URL('../.env.local', import.meta.url), 'utf-8');
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const serviceAccount = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_KEY!, 'base64').toString('utf-8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const [, , eventCode] = process.argv;
if (!eventCode) {
  console.error('Usage: npx tsx scripts/simulate-generation.ts <eventCode>');
  process.exit(1);
}

const eventDoc = await db.collection('events').doc(eventCode).get();
const event = eventDoc.data()!;
const games = (await db.collection('events').doc(eventCode).collection('games').get()).docs.map((d) => ({ id: d.id, ...d.data() })) as any;
const players = (await db.collection('events').doc(eventCode).collection('players').get()).docs.map((d) => ({ id: d.id, ...d.data() })) as any;
const allTables = (await db.collection('events').doc(eventCode).collection('tables').get()).docs.map((d) => ({ id: d.id, ...d.data() })) as any;

// Mirrors runTableGeneration: only confirmed tables survive a regeneration, everything else is rebuilt fresh.
const lockedTables = allTables.filter((t: any) => t.status === 'confirmed');
const batchNumber = lockedTables.length > 0 ? Math.max(...lockedTables.map((t: any) => t.batchNumber)) + 1 : 1;

const proposals = generateTables(players, games, lockedTables, event.settings.bufferMinutes, event.settings.physicalTables, batchNumber, event.settings.breaks ?? []);

console.log(`=== SIMULATED PROPOSALS (${proposals.length}) ===`);
for (const t of proposals) {
  const names = t.playerIds.map((pid: string) => players.find((p: any) => p.id === pid)?.name ?? pid);
  console.log(`- ${t.gameName} ${t.startTime}-${t.endTime} players=[${names.join(', ')}]`);
}

process.exit(0);
