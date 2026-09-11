// Read-only Firestore diagnostic tool for MeepleMatch/Meeple Loop events.
// Dumps event settings, games, players (votes/canExplain/repeat), tables, and per-player idle
// gaps — useful for debugging why the table-generation algorithm did (or didn't) schedule something.
//
// Usage:
//   node scripts/diagnose-event.mjs <eventCode>                  # full event dump
//   node scripts/diagnose-event.mjs <eventCode> <gameNameSubstr>  # + focused vote breakdown for that game
//
// Reads FIREBASE_SERVICE_ACCOUNT_KEY from .env.local via the Admin SDK (bypasses Firestore rules,
// read-only here). Never commit real credentials — this script only reads process.env at runtime.
import { readFileSync } from 'fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const envText = readFileSync(new URL('../.env.local', import.meta.url), 'utf-8');
// .env.local uses CRLF — splitting on '\n' alone leaves a trailing '\r' that breaks `(.*)$`
// (JS `.` excludes \r), so the whole line fails to match. Always split on /\r?\n/.
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const serviceAccount = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf-8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const [, , eventCode, gameNameSubstr] = process.argv;
if (!eventCode) {
  console.error('Usage: node scripts/diagnose-event.mjs <eventCode> [gameNameSubstring]');
  process.exit(1);
}

function toMin(hhmm) { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }
function toHHMM(min) { return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0'); }

const eventDoc = await db.collection('events').doc(eventCode).get();
if (!eventDoc.exists) { console.error('Event not found:', eventCode); process.exit(1); }
const event = eventDoc.data();
console.log('=== EVENT ===');
console.log(JSON.stringify({ date: event.date, startTime: event.startTime, endTime: event.endTime, settings: event.settings }, null, 2));

const gamesSnap = await db.collection('events').doc(eventCode).collection('games').get();
const games = gamesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
const gameMap = new Map(games.map((g) => [g.id, g]));

const playersSnap = await db.collection('events').doc(eventCode).collection('players').get();
const players = playersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
const playerMap = new Map(players.map((p) => [p.id, p]));

const tablesSnap = await db.collection('events').doc(eventCode).collection('tables').get();
const tables = tablesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

console.log('\n=== GAMES (' + games.length + ') ===');
for (const g of games) {
  const groupNote = g.groupId ? (g.groupId === g.id ? ' [PRINCIPAL de grupo]' : ` [copia de ${g.groupId}]`) : '';
  console.log(`- ${g.name} | id=${g.id} | ${g.minPlayers}-${g.maxPlayers}p | ${g.durationMinutes}min | owner=${g.ownerName}${groupNote}`);
}

console.log('\n=== PLAYERS (' + players.length + ') ===');
for (const p of players) {
  const votes = Object.entries(p.interests || {}).map(([gid, v]) => `${gameMap.get(gid)?.name ?? gid}:${v}${p.canExplain?.includes(gid) ? '(explica)' : ''}${p.repeatGameIds?.includes(gid) ? '(repite)' : ''}`).join(', ');
  console.log(`- ${p.name} | ${p.arrivalTime}-${p.departureTime} | votes: ${votes}`);
}

console.log('\n=== TABLES (' + tables.length + ') ===');
for (const t of tables.sort((a, b) => (a.startTime > b.startTime ? 1 : -1))) {
  const names = t.playerIds.map((pid) => playerMap.get(pid)?.name ?? pid);
  const explainerNote = t.explainerIsPlaying === false ? ` explainerOnly=${playerMap.get(t.explainerId)?.name ?? t.explainerId}` : '';
  console.log(`- [${t.status}] ${t.gameName} ${t.startTime}-${t.endTime} tableNum=${t.tableNumber} batch=${t.batchNumber} players=[${names.join(', ')}]${explainerNote}`);
}

console.log('\n=== PER-PLAYER SCHEDULE + IDLE GAPS ===');
for (const p of players) {
  const busy = tables.filter((t) => t.playerIds.includes(p.id) && t.status !== 'cancelled')
    .map((t) => ({ start: toMin(t.startTime), end: toMin(t.endTime), name: t.gameName }))
    .sort((a, b) => a.start - b.start);
  let cursor = toMin(p.arrivalTime);
  const depart = toMin(p.departureTime);
  const gaps = [];
  for (const b of busy) {
    if (b.start > cursor) gaps.push(`${toHHMM(cursor)}-${toHHMM(b.start)} (${b.start - cursor}min)`);
    cursor = Math.max(cursor, b.end);
  }
  if (depart > cursor) gaps.push(`${toHHMM(cursor)}-${toHHMM(depart)} (${depart - cursor}min)`);
  const totalGap = gaps.reduce((sum, g) => sum + parseInt(g.match(/\((\d+)min\)/)[1], 10), 0);
  console.log(`- ${p.name} (${p.arrivalTime}-${p.departureTime}): mesas=[${busy.map((b) => b.name + ' ' + toHHMM(b.start) + '-' + toHHMM(b.end)).join(', ')}] | huecos=[${gaps.join(', ')}] | totalIdle=${totalGap}min`);
}

if (gameNameSubstr) {
  const target = games.find((g) => g.name.toLowerCase().includes(gameNameSubstr.toLowerCase()));
  if (!target) {
    console.log('\nGame not found matching:', gameNameSubstr);
  } else {
    console.log(`\n=== FOCUSED VOTE BREAKDOWN: ${target.name} (${target.minPlayers}-${target.maxPlayers}p, ${target.durationMinutes}min) ===`);
    for (const p of players) {
      const vote = p.interests?.[target.id];
      const canExplain = p.canExplain?.includes(target.id);
      const repeat = p.repeatGameIds?.includes(target.id);
      if (vote || canExplain) {
        const busy = tables.filter((t) => t.playerIds.includes(p.id) && t.status !== 'cancelled');
        const busyStr = busy.length === 0 ? 'FREE ALL DAY' : busy.map((t) => `${t.gameName} ${t.startTime}-${t.endTime}`).join(' | ');
        console.log(`- ${p.name}: vote=${vote ?? '(sin voto)'} canExplain=${!!canExplain} repeat=${!!repeat} arrival=${p.arrivalTime}-${p.departureTime} busy=[${busyStr}]`);
      }
    }
  }
}

process.exit(0);
