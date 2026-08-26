import type { Player, Game, Table, TableStatus } from './types';
import { toMinutes, toTimeString, windowDuration } from './timeUtils';

interface TableProposal {
  gameId: string;
  gameName: string;
  startTime: string;
  endTime: string;
  explainerId: string;
  playerIds: string[];
  status: TableStatus;
  isManuallyEdited: boolean;
  batchNumber: number;
  tableNumber: number;
}

function getBusyWindows(playerId: string, tables: Table[]) {
  return tables
    .filter((t) => t.playerIds.includes(playerId) && t.status !== 'cancelled')
    .map((t) => ({ start: t.startTime, end: t.endTime }));
}

function isAvailable(
  player: Player,
  winStart: string,
  winEnd: string,
  busy: { start: string; end: string }[]
): boolean {
  const ws = toMinutes(winStart);
  const we = toMinutes(winEnd);
  if (ws < toMinutes(player.arrivalTime) || we > toMinutes(player.departureTime)) return false;
  return busy.every((bw) => toMinutes(bw.end) <= ws || toMinutes(bw.start) >= we);
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return toMinutes(aStart) < toMinutes(bEnd) && toMinutes(aEnd) > toMinutes(bStart);
}

/** How many of the given tables are physically occupying a seat during [start, end) */
function concurrentTableCount(occupied: { startTime: string; endTime: string }[], start: string, end: string): number {
  return occupied.filter((t) => overlaps(t.startTime, t.endTime, start, end)).length;
}

// Table start times are rounded up to this grid so schedules read as "10:30", not "10:39"
const ROUND_MIN = 15;

function roundUpToGrid(minutes: number): number {
  return Math.ceil(minutes / ROUND_MIN) * ROUND_MIN;
}

function findEarliestWindow(
  players: Player[],
  durationMinutes: number,
  bufferMinutes: number,
  busyMap: Map<string, { start: string; end: string }[]>,
  physicalTables: number | null,
  occupiedTables: { startTime: string; endTime: string }[]
): { start: string; end: string } | null {
  const candidates = new Set<number>();
  players.forEach((p) => {
    candidates.add(roundUpToGrid(toMinutes(p.arrivalTime)));
    (busyMap.get(p.id) ?? []).forEach((bw) =>
      candidates.add(roundUpToGrid(toMinutes(bw.end) + bufferMinutes))
    );
  });
  if (physicalTables != null) {
    // A physical table only frees up once an occupying game finishes (+ buffer to reset it)
    occupiedTables.forEach((t) => candidates.add(roundUpToGrid(toMinutes(t.endTime) + bufferMinutes)));
  }

  for (const startMin of Array.from(candidates).sort((a, b) => a - b)) {
    const start = toTimeString(startMin);
    const end = toTimeString(startMin + durationMinutes);
    if (!players.every((p) => isAvailable(p, start, end, busyMap.get(p.id) ?? []))) continue;
    if (physicalTables != null && concurrentTableCount(occupiedTables, start, end) >= physicalTables) continue;
    return { start, end };
  }
  return null;
}

export function generateTables(
  players: Player[],
  games: Game[],
  existingTables: Table[],
  bufferMinutes: number,
  physicalTables: number | null,
  batchNumber: number,
  lunchBreak: { start: string; end: string } | null = null
): TableProposal[] {
  const busyMap = new Map<string, { start: string; end: string }[]>();
  players.forEach((p) => {
    const busy = getBusyWindows(p.id, existingTables);
    // Blocks every player during lunch so no table can be scheduled across it
    if (lunchBreak) busy.push(lunchBreak);
    busyMap.set(p.id, busy);
  });
  const occupiedTables: { startTime: string; endTime: string }[] = existingTables
    .filter((t) => t.status !== 'cancelled')
    .map((t) => ({ startTime: t.startTime, endTime: t.endTime }));

  const sorted = [...games].sort((a, b) => {
    const mustA = players.filter((p) => p.interests[a.id] === 'must').length;
    const mustB = players.filter((p) => p.interests[b.id] === 'must').length;
    if (mustB !== mustA) return mustB - mustA;
    const totA = mustA + players.filter((p) => p.interests[a.id] === 'casual').length;
    const totB = mustB + players.filter((p) => p.interests[b.id] === 'casual').length;
    const ratioA = totA > 0 ? mustA / totA : 0;
    const ratioB = totB > 0 ? mustB / totB : 0;
    if (ratioB !== ratioA) return ratioB - ratioA;
    return a.minPlayers - b.minPlayers;
  });

  const proposals: TableProposal[] = [];
  let tableNumber = existingTables.length
    ? Math.max(...existingTables.map((t) => t.tableNumber)) + 1
    : 1;

  for (const game of sorted) {
    const mustPlayers = players.filter((p) => p.interests[game.id] === 'must');
    const casualPlayers = players.filter((p) => p.interests[game.id] === 'casual');
    const explainers = players.filter(
      (p) => p.canExplain.includes(game.id) && p.interests[game.id] !== 'no'
    );

    if (explainers.length === 0) continue;
    if (mustPlayers.length < game.minPlayers) continue;

    const coreGroup = mustPlayers.slice(0, game.maxPlayers);

    const hasExplainer = coreGroup.some((p) => p.canExplain.includes(game.id));
    if (!hasExplainer) {
      const extra = explainers.find((e) => coreGroup.every((p) => p.id !== e.id));
      if (!extra || coreGroup.length >= game.maxPlayers) continue;
      coreGroup.push(extra);
    }

    const window = findEarliestWindow(coreGroup, game.durationMinutes, bufferMinutes, busyMap, physicalTables, occupiedTables);
    if (!window) continue;

    const group = [...coreGroup];
    for (const casual of casualPlayers) {
      if (group.length >= game.maxPlayers) break;
      if (group.some((p) => p.id === casual.id)) continue;
      if (isAvailable(casual, window.start, window.end, busyMap.get(casual.id) ?? []))
        group.push(casual);
    }

    const explainer = group
      .filter((p) => p.canExplain.includes(game.id))
      .sort((a, b) => windowDuration(b.arrivalTime, b.departureTime) - windowDuration(a.arrivalTime, a.departureTime))[0];

    group.forEach((p) => {
      const bw = busyMap.get(p.id) ?? [];
      bw.push(window);
      busyMap.set(p.id, bw);
    });

    proposals.push({
      gameId: game.id,
      gameName: game.name,
      startTime: window.start,
      endTime: window.end,
      explainerId: explainer.id,
      playerIds: group.map((p) => p.id),
      status: 'proposed',
      isManuallyEdited: false,
      batchNumber,
      tableNumber: tableNumber++,
    });
    occupiedTables.push({ startTime: window.start, endTime: window.end });
  }

  return proposals;
}
