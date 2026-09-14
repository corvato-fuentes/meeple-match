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

// Mirrors runTableGeneration: only non-cancelled tables survive a regeneration as context —
// 'recommended' ones just get extended with new candidates, never wiped.
const activeTables = allTables.filter((t: any) => t.status !== 'cancelled');
const batchNumber = activeTables.length > 0 ? Math.max(...activeTables.map((t: any) => t.batchNumber)) + 1 : 1;

const { proposals, candidateUpdates } = generateTables(players, games, activeTables, event.settings.bufferMinutes, event.settings.physicalTables, batchNumber, event.settings.breaks ?? []);

console.log(`=== NEW RECOMMENDED TABLES (${proposals.length}) ===`);
for (const t of proposals) {
  const names = t.candidateIds.map((pid: string) => players.find((p: any) => p.id === pid)?.name ?? pid);
  console.log(`- ${t.gameName} ${t.startTime}-${t.endTime} candidates=[${names.join(', ')}]`);
}

console.log(`\n=== CANDIDATE UPDATES TO EXISTING OPEN TABLES (${candidateUpdates.length}) ===`);
for (const u of candidateUpdates) {
  const table = allTables.find((t: any) => t.id === u.tableId);
  const names = u.candidateIds.map((pid: string) => players.find((p: any) => p.id === pid)?.name ?? pid);
  console.log(`- ${table?.gameName ?? u.tableId}: candidates now [${names.join(', ')}]`);
}

// Flags any game with enough total votes to hit its minimum that still ended up with zero table —
// worth checking by hand, since it means the schedule genuinely has no room for it right now.
const scheduledGameIds = new Set([...activeTables.map((t: any) => t.gameId), ...proposals.map((t) => t.gameId)]);
const primaryGames = games.filter((g: any) => !g.groupId || g.groupId === g.id);
console.log('\n=== ORPHANED GAMES (enough votes, zero tables) ===');
for (const g of primaryGames) {
  if (scheduledGameIds.has(g.id)) continue;
  const yes = players.filter((p: any) => p.interests?.[g.id] === 'yes').length;
  if (yes >= g.minPlayers) {
    console.log(`- ${g.name} (${g.minPlayers}-${g.maxPlayers}p, ${g.durationMinutes}min): yes=${yes}`);
  }
}

process.exit(0);
