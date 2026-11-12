import type { Player, Game, Table } from './types';
import { toMinutes, toTimeString, windowDuration, roundUp5 } from './timeUtils';
import { minSeats } from './seats';

interface TableProposal {
  gameId: string;
  gameName: string;
  startTime: string;
  endTime: string;
  explainerId: string;
  playerIds: string[]; // always empty at creation — nobody has accepted yet
  // Explainer first (see Table.awaitingExplainer): the table is offered only to the people who can explain the game, all
  // at once (`candidateIds`); the others wait in `queuedIds` until one of them accepts. `explainerId` is provisional.
  candidateIds: string[];
  queuedIds: string[];
  awaitingExplainer: true;
  rejectedIds: string[];
  status: 'recommended';
  isManuallyEdited: boolean;
  batchNumber: number;
  tableNumber: number;
}

export interface CandidateUpdate {
  tableId: string;
  // Full updated list (existing + newly added). For a table still waiting on its explainer the newcomers go to the
  // queue (`queuedIds`) instead of being offered it straight away.
  candidateIds?: string[];
  queuedIds?: string[];
}

export interface GenerateTablesResult {
  proposals: TableProposal[];
  candidateUpdates: CandidateUpdate[];
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
  busy: { start: string; end: string }[],
  bufferMinutes: number
): boolean {
  const ws = toMinutes(winStart);
  const we = toMinutes(winEnd);
  // Buffer applies right after arrival too — nobody sits down and starts playing the instant
  // they walk in, regardless of which candidate time slot this window came from.
  if (ws < toMinutes(player.arrivalTime) + bufferMinutes || we > toMinutes(player.departureTime)) return false;
  // A buffer gap is required on both sides — not just "no overlap" — so a player never goes
  // straight from one table into the next with zero time to stand up and walk over.
  return busy.every((bw) => toMinutes(bw.end) + bufferMinutes <= ws || we + bufferMinutes <= toMinutes(bw.start));
}

export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return toMinutes(aStart) < toMinutes(bEnd) && toMinutes(aEnd) > toMinutes(bStart);
}

/**
 * The player's own table, if any, whose time window overlaps the given one — used to catch
 * scheduling conflicts (e.g. accepting a recommended table while already seated at a posted one
 * that overlaps) before writing the new commitment. Ignores cancelled tables and `excludeTableId`
 * (the table being joined/accepted itself, in case it's already reflected in the list).
 */
export function findConflictingTable(
  playerId: string,
  start: string,
  end: string,
  tables: Table[],
  excludeTableId?: string
): Table | null {
  return findConflictingTables(playerId, start, end, tables, excludeTableId)[0] ?? null;
}

/**
 * All of the player's tables whose window overlaps the given one, earliest first: a long table can overlap several short ones,
 * and taking it means leaving every one of them.
 */
export function findConflictingTables(
  playerId: string,
  start: string,
  end: string,
  tables: Table[],
  excludeTableId?: string
): Table[] {
  return tables
    .filter((t) =>
      t.id !== excludeTableId &&
      t.status !== 'cancelled' &&
      t.playerIds.includes(playerId) &&
      overlaps(t.startTime, t.endTime, start, end))
    .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
}

/**
 * The other live tables of the same game that a table running [start, end) can't share its copy with: when more of them
 * overlap it (buffer counted on both sides, the box has to be reset in between) than the game has copies, so they can't
 * all happen. Empty when everything fits. Used to warn the admin — nothing is changed or blocked.
 */
export function sameGameOverlaps(args: {
  tables: Table[];
  table: Pick<Table, 'id' | 'gameId'>;
  start: string;
  end: string;
  bufferMinutes: number;
  gameCopies: number;
}): Table[] {
  const { tables, table, start, end, bufferMinutes, gameCopies } = args;
  const others = tables.filter((t) =>
    t.id !== table.id && t.gameId === table.gameId && (t.status === 'recommended' || t.status === 'confirmed' || t.status === 'in-progress') &&
    overlaps(toTimeString(toMinutes(t.startTime) - bufferMinutes), toTimeString(toMinutes(t.endTime) + bufferMinutes), start, end));
  return others.length + 1 > Math.max(1, gameCopies) ? others : [];
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

/**
 * A game's actual playing time depends on how many people are at the table, once the admin/owner
 * fills in per-player/setup/explanation minutes. Falls back to the flat `durationMinutes` when
 * none of those are set, so existing games with only a flat duration keep working unchanged.
 */
export function estimatedDuration(game: Game, playerCount: number): number {
  // Always rounded up to a multiple of 5 so every estimate reads "40min", never "38min".
  if (game.perPlayerMinutes == null && game.setupMinutes == null && game.explanationMinutes == null) {
    return roundUp5(game.durationMinutes);
  }
  return roundUp5((game.setupMinutes ?? 0) + (game.explanationMinutes ?? 0) + (game.perPlayerMinutes ?? 0) * playerCount);
}

/**
 * When a table should end: it reserves the time the game takes with every seat taken (explanation included), from the moment
 * it exists. The reservation does not move when people join or leave, so what the schedule shows is what is held: nobody
 * who books another table after this one can end up overlapped by it growing. The time is capped at the end of the day.
 */
export function expectedTableEnd(table: Pick<Table, 'startTime'>, game: Game): string {
  return toTimeString(Math.min(toMinutes(table.startTime) + estimatedDuration(game, game.maxPlayers), 24 * 60 - 1));
}

/**
 * How many of the people who voted a game yes could take a table of it at [start, end): `interested` is everyone who voted
 * it who still need a table (not the poster, and not someone who already has one of this game: they are not waiting), and
 * `available` the ones it works for — they are there and free. Used to tell whoever posts a table how well a time fits.
 */
export function interestAtSlot(args: {
  gameId: string; start: string; end: string; posterId: string; players: Player[]; tables: Table[]; bufferMinutes: number;
}): { interested: number; available: number } {
  const { gameId, start, end, posterId, players, tables, bufferMinutes } = args;
  const hypothetical = {
    id: '__new__', gameId, startTime: start, endTime: end, playerIds: [posterId], candidateIds: [], rejectedIds: [],
    status: 'recommended', postedByOwner: true,
  } as unknown as Table;
  const rows = interestedInTable(hypothetical, players, tables, bufferMinutes);
  const waiting = rows.filter((r) => !r.hasOtherTable);
  return { interested: waiting.length, available: waiting.filter((r) => !r.busy).length };
}

export interface StartSuggestion { start: string; end: string; available: number; interested: number }

/**
 * Start times worth suggesting to whoever posts a table: the ones that work for the most people who voted the game. Only times
 * the poster can really take (they're there and free, a copy of the game and a table of the venue are free then — see
 * `postedSlotConflict`) on a 15-minute grid, best first and at least an hour apart so the list gives choices instead of
 * neighbours. A time nobody interested can take is never suggested.
 */
export function suggestPostedStarts(args: {
  game: Pick<Game, 'durationMinutes'> & { id: string };
  poster: Player;
  players: Player[];
  tables: Table[];
  bufferMinutes: number;
  eventStart: string;
  eventEnd: string;
  gameCopies: number;
  physicalTables: number | null;
  limit?: number;
}): StartSuggestion[] {
  const { game, poster, players, tables, bufferMinutes, eventStart, eventEnd, gameCopies, physicalTables, limit = 3 } = args;
  const minutes = roundUp5(game.durationMinutes);
  const firstStart = Math.max(toMinutes(eventStart), toMinutes(poster.arrivalTime) + bufferMinutes);
  const lastEnd = Math.min(toMinutes(eventEnd), toMinutes(poster.departureTime));
  const posterBusy = getBusyWindows(poster.id, tables);
  const all: StartSuggestion[] = [];
  for (let start = roundUpToGrid(firstStart); start + minutes <= lastEnd; start += ROUND_MIN) {
    const s = toTimeString(start);
    const e = toTimeString(start + minutes);
    if (!isAvailable(poster, s, e, posterBusy, bufferMinutes)) continue;
    if (postedSlotConflict({ tables, gameId: game.id, start: s, end: e, bufferMinutes, gameCopies, physicalTables })) continue;
    const { interested, available } = interestAtSlot({ gameId: game.id, start: s, end: e, posterId: poster.id, players, tables, bufferMinutes });
    if (available > 0) all.push({ start: s, end: e, available, interested });
  }
  all.sort((a, b) => b.available - a.available || toMinutes(a.start) - toMinutes(b.start));
  const picked: StartSuggestion[] = [];
  for (const c of all) {
    if (picked.every((p) => Math.abs(toMinutes(p.start) - toMinutes(c.start)) >= 60)) picked.push(c);
    if (picked.length >= limit) break;
  }
  return picked;
}

/**
 * For a table its owner already posted (still waiting for players): how well its current time works for the people who voted
 * the game, and the times that would work for more of them — people vote after a table is posted too. Everything is looked
 * at with the table itself taken out of the schedule, so its own seats don't count against it. The table keeps its length.
 */
export function suggestMovesForPostedTable(args: {
  table: Table;
  poster: Player;
  players: Player[];
  tables: Table[];
  bufferMinutes: number;
  eventStart: string;
  eventEnd: string;
  gameCopies: number;
  physicalTables: number | null;
}): { current: { interested: number; available: number }; better: StartSuggestion[] } {
  const { table, poster, players, tables, bufferMinutes, eventStart, eventEnd, gameCopies, physicalTables } = args;
  const others = tables.filter((t) => t.id !== table.id);
  const current = interestAtSlot({ gameId: table.gameId, start: table.startTime, end: table.endTime, posterId: poster.id, players, tables: others, bufferMinutes });
  const options = suggestPostedStarts({
    game: { id: table.gameId, durationMinutes: toMinutes(table.endTime) - toMinutes(table.startTime) },
    poster, players, tables: others, bufferMinutes, eventStart, eventEnd, gameCopies, physicalTables, limit: 4,
  });
  return { current, better: options.filter((o) => o.start !== table.startTime && o.available > current.available).slice(0, 2) };
}

/**
 * The tables that haven't started where the player is seated but would no longer be able to be with the arrival and
 * departure they are about to save: one starts before they arrive (plus the buffer a person needs after arriving) or ends
 * after they leave. Waiting-for-players and confirmed tables only; the ones already underway are not asked about.
 */
export function tablesOutsideAvailability(args: {
  tables: Table[];
  playerId: string;
  arrivalTime: string;
  departureTime: string;
  bufferMinutes: number;
}): Table[] {
  const { tables, playerId, arrivalTime, departureTime, bufferMinutes } = args;
  const from = toMinutes(arrivalTime) + bufferMinutes;
  const to = toMinutes(departureTime);
  return tables
    .filter((t) => (t.status === 'recommended' || t.status === 'confirmed') && t.playerIds.includes(playerId) &&
      (toMinutes(t.startTime) < from || toMinutes(t.endTime) > to))
    .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
}

/**
 * How long the table would actually last with the people it has now (never fewer than the game's minimum). Shown next to
 * the time the table reserves, so people see both: what it takes today and what is held for it. Null once every seat is
 * taken: then the two are the same thing.
 */
export function estimateAtCurrentSeats(
  table: Pick<Table, 'startTime' | 'playerIds'>, game: Game
): { seats: number; minutes: number; endTime: string } | null {
  if (table.playerIds.length >= game.maxPlayers) return null;
  const seats = Math.max(minSeats(game), table.playerIds.length);
  const minutes = estimatedDuration(game, seats);
  return { seats, minutes, endTime: toTimeString(Math.min(toMinutes(table.startTime) + minutes, 24 * 60 - 1)) };
}

/** The game's full min↔max duration span — shortest at minPlayers, longest at maxPlayers seated. */
export function estimatedDurationRange(game: Game): [number, number] {
  return [estimatedDuration(game, game.minPlayers), estimatedDuration(game, game.maxPlayers)];
}

/** Why an owner-posted table can't take the slot it asked for. */
export type SlotConflict = { kind: 'copy'; table: Table } | { kind: 'physical' };

/**
 * Does an owner-posted table at [start, end) fit? It doesn't when every copy of that game is already in use then by a
 * CONFIRMED table (the box needs the buffer to be reset between two tables, so the buffer counts on both sides) or when
 * every physical table of the venue is taken by confirmed tables. Tables that are only suggestions (still waiting for
 * people) don't block it: they can coexist until one of them is set. Null when it fits.
 */
export function postedSlotConflict(args: {
  tables: Table[];
  gameId: string;
  start: string;
  end: string;
  bufferMinutes: number;
  gameCopies: number;
  physicalTables: number | null;
}): SlotConflict | null {
  const { tables, gameId, start, end, bufferMinutes, gameCopies, physicalTables } = args;
  const live = tables.filter((t) => t.status === 'confirmed' || t.status === 'in-progress' || t.status === 'completed');
  const sameGame = live.filter(
    (t) => t.gameId === gameId && overlaps(toTimeString(toMinutes(t.startTime) - bufferMinutes), toTimeString(toMinutes(t.endTime) + bufferMinutes), start, end)
  );
  if (sameGame.length >= Math.max(1, gameCopies)) return { kind: 'copy', table: sameGame[0] };
  if (physicalTables != null && concurrentTableCount(live, start, end) >= physicalTables) return { kind: 'physical' };
  return null;
}

/**
 * The people interested in a table that aren't in it: everyone who voted its game yes, plus whoever it was offered to.
 * Each one is marked `busy` when they couldn't take it — it doesn't fit their hours, they're at another table then, or
 * (for a table an owner posted) they already have a table of that game, unless they'd join a second one. Worked out from
 * the votes themselves, so it doesn't depend on the offers already having been written. Whoever declined the table is out.
 * `hasOtherTable` tells the ones who are busy only because they already have a table of this game.
 */
export function interestedInTable(table: Table, players: Player[], tables: Table[], bufferMinutes: number): { player: Player; busy: boolean; hasOtherTable: boolean }[] {
  const seated = new Set(table.playerIds);
  const rejected = new Set(table.rejectedIds ?? []);
  const asked = new Set([...(table.candidateIds ?? []), ...(table.queuedIds ?? [])]);
  const others = tables.filter((o) => o.id !== table.id);
  return players
    .filter((p) => !seated.has(p.id) && !rejected.has(p.id) && (asked.has(p.id) || p.interests[table.gameId] === 'yes'))
    .map((p) => {
      const seatedElsewhere = !!table.postedByOwner && !(p.repeatGameIds ?? []).includes(table.gameId) &&
        others.some((o) => o.gameId === table.gameId && o.status !== 'cancelled' && o.playerIds.includes(p.id));
      const busy = seatedElsewhere || !isAvailable(p, table.startTime, table.endTime, getBusyWindows(p.id, others), bufferMinutes);
      return { player: p, busy, hasOtherTable: seatedElsewhere };
    });
}

/**
 * The tables an owner-posted table at [start, end) takes the place of: suggestions for the same game that overlap it
 * (buffer on both sides) and aren't confirmed yet — a copy can only be in one table at a time, and the one its owner
 * posted wins. Nothing is replaced while a copy is still free for them (more copies than tables already using it), and
 * tables other people posted are never replaced. Check `postedSlotConflict` first: confirmed tables block the post.
 */
export function replaceableByPostedTable(args: {
  tables: Table[];
  gameId: string;
  start: string;
  end: string;
  bufferMinutes: number;
  gameCopies: number;
}): Table[] {
  const { tables, gameId, start, end, bufferMinutes, gameCopies } = args;
  const near = (t: Table) =>
    t.gameId === gameId && overlaps(toTimeString(toMinutes(t.startTime) - bufferMinutes), toTimeString(toMinutes(t.endTime) + bufferMinutes), start, end);
  const inUse = tables.filter((t) => near(t) && (t.status === 'confirmed' || t.status === 'in-progress' || t.status === 'completed')).length;
  if (inUse + 1 < Math.max(1, gameCopies)) return []; // another copy is free for the suggestion
  return tables.filter((t) => near(t) && t.status === 'recommended' && !t.postedByOwner);
}

function findEarliestWindow(
  players: Player[],
  game: Game,
  bufferMinutes: number,
  busyMap: Map<string, { start: string; end: string }[]>,
  physicalTables: number | null,
  occupiedTables: { startTime: string; endTime: string }[],
  sameGameWindows: { startTime: string; endTime: string }[],
  gameCopies: number,
  ownerWindows: { start: string; end: string; ownerId: string; lendable: boolean }[]
): { start: string; end: string } | null {
  // A table reserves the time for every seat taken, however many people it starts with: people join later and the time
  // can't grow after others have planned around it (see expectedTableEnd).
  const durationMinutes = estimatedDuration(game, game.maxPlayers);
  const candidates = new Set<number>();
  players.forEach((p) => {
    // Buffer applies after arrival too — nobody sits down and starts playing the instant they walk in
    candidates.add(roundUpToGrid(toMinutes(p.arrivalTime) + bufferMinutes));
    (busyMap.get(p.id) ?? []).forEach((bw) =>
      candidates.add(roundUpToGrid(toMinutes(bw.end) + bufferMinutes))
    );
  });
  if (physicalTables != null) {
    // A physical table only frees up once an occupying game finishes (+ buffer to reset it)
    occupiedTables.forEach((t) => candidates.add(roundUpToGrid(toMinutes(t.endTime) + bufferMinutes)));
  }
  // A copy of this exact game needs one of its own copies freed up too — up to gameCopies tables
  // of it can run at once (more than 1 only when the admin merged duplicate entries together).
  sameGameWindows.forEach((t) => candidates.add(roundUpToGrid(toMinutes(t.endTime) + bufferMinutes)));
  // Padding each existing window's end by the buffer means a copy freed up right at that instant
  // still counts as "in use" for a bit longer — blocking an immediate back-to-back reuse (same
  // box needs to be reset) while still allowing true parallel copies to overlap.
  const paddedSameGameWindows = sameGameWindows.map((t) => ({
    startTime: t.startTime,
    endTime: toTimeString(toMinutes(t.endTime) + bufferMinutes),
  }));
  // The physical copy can't be in play before its owner has actually brought it to the venue
  ownerWindows.forEach((w) => candidates.add(roundUpToGrid(toMinutes(w.start))));

  for (const startMin of Array.from(candidates).sort((a, b) => a - b)) {
    const start = toTimeString(startMin);
    const end = toTimeString(startMin + durationMinutes);
    if (!players.every((p) => isAvailable(p, start, end, busyMap.get(p.id) ?? [], bufferMinutes))) continue;
    if (physicalTables != null && concurrentTableCount(occupiedTables, start, end) >= physicalTables) continue;
    if (concurrentTableCount(paddedSameGameWindows, start, end) >= gameCopies) continue;
    // The game can only be scheduled while at least one of its owners is actually at the venue to
    // have brought the physical copy. If that owner didn't opt in to lend it out, they also need
    // to be one of the seated players — otherwise their copy can't leave their hands.
    if (ownerWindows.length > 0 && !ownerWindows.some((w) =>
      toMinutes(w.start) <= startMin && startMin + durationMinutes <= toMinutes(w.end) &&
      (w.lendable || players.some((p) => p.id === w.ownerId))
    )) continue;
    return { start, end };
  }
  return null;
}

/**
 * Builds the set of "recommended" tables the algorithm can offer right now, from every player's
 * simple 👍/👎 vote. A recommended table isn't real yet — it's a candidate pool + a fixed window;
 * players accept or reject individually (see respondToRecommendation in firestore.ts), and only
 * once enough have accepted does it become 'confirmed'.
 *
 * Two things can happen per game:
 * 1. An already-open recommended table (candidates still being gathered) gets NEW candidates
 *    added if a fresh voter fits its already-fixed window — this never changes an existing
 *    table's time once people have started responding to it.
 * 2. Voters not absorbed by any open table (none exists yet, or all are full) get grouped into
 *    brand new recommended table(s), same greedy window-search as before, just without any
 *    must/casual tiering now that there's only one vote level.
 */
export function generateTables(
  players: Player[],
  games: Game[],
  existingTables: Table[],
  bufferMinutes: number,
  physicalTables: number | null,
  batchNumber: number,
  breaks: { start: string; end: string }[] = []
): GenerateTablesResult {
  const busyMap = new Map<string, { start: string; end: string }[]>();
  players.forEach((p) => {
    const busy = getBusyWindows(p.id, existingTables);
    // Blocks every player during scheduled breaks so no table can be scheduled across them
    busy.push(...breaks);
    busyMap.set(p.id, busy);
  });
  const occupiedTables: { startTime: string; endTime: string }[] = existingTables
    .filter((t) => t.status !== 'cancelled')
    .map((t) => ({ startTime: t.startTime, endTime: t.endTime }));

  // Everyone already offered a seat (candidate, accepted, or rejected) on ANY non-cancelled table
  // for a game — a fresh proposal never re-offers these people unless they opted into a repeat.
  const offeredByGame = new Map<string, Set<string>>();
  // People who turned down explaining a game: a table that fell through for that reason is cancelled, and without this
  // the next pass would just offer them to explain the same game again.
  const declinedExplainers = new Map<string, Set<string>>();
  existingTables.forEach((t) => {
    if (t.status === 'cancelled') {
      if (t.awaitingExplainer) {
        const declined = declinedExplainers.get(t.gameId) ?? new Set<string>();
        (t.rejectedIds ?? []).forEach((id) => declined.add(id));
        declinedExplainers.set(t.gameId, declined);
      }
      return;
    }
    const offered = offeredByGame.get(t.gameId) ?? new Set<string>();
    t.playerIds.forEach((id) => offered.add(id));
    (t.candidateIds ?? []).forEach((id) => offered.add(id));
    (t.queuedIds ?? []).forEach((id) => offered.add(id));
    (t.rejectedIds ?? []).forEach((id) => offered.add(id));
    offeredByGame.set(t.gameId, offered);
  });

  const proposals: TableProposal[] = [];
  const candidateUpdates: CandidateUpdate[] = [];

  // A game that only has enough demand left through repeat-flagged voters (no fresh voters
  // remain to justify it on its own) is treated as a last resort — every other viable game gets
  // tried first, so a repeat only fills someone's second table once nothing else fits for them.
  function isRepeatFallbackOnly(game: Game): boolean {
    const offered = offeredByGame.get(game.id);
    if (!offered || offered.size === 0) return false;
    const voters = players.filter((p) => p.interests[game.id] === 'yes');
    const freshVoters = voters.filter((p) => !offered.has(p.id));
    return freshVoters.length < minSeats(game);
  }

  const sorted = [...games].sort((a, b) => {
    const fallbackA = isRepeatFallbackOnly(a);
    const fallbackB = isRepeatFallbackOnly(b);
    if (fallbackA !== fallbackB) return fallbackA ? 1 : -1;
    const totA = players.filter((p) => p.interests[a.id] === 'yes').length;
    const totB = players.filter((p) => p.interests[b.id] === 'yes').length;
    // A game with enough voters for only ONE table this pass (not even close to double its
    // minimum) has zero room to recover if it loses just one of them to another game's schedule —
    // it either happens now or never. A game with enough demand for several tables degrades
    // gracefully instead (just forms fewer of them), so it keeps competing on raw popularity
    // like before instead of being treated as equally "at risk".
    const singleShotA = totA < 2 * minSeats(a);
    const singleShotB = totB < 2 * minSeats(b);
    if (singleShotA !== singleShotB) return singleShotA ? -1 : 1;
    if (singleShotA && singleShotB) {
      const slackA = totA - minSeats(a);
      const slackB = totB - minSeats(b);
      if (slackA !== slackB) return slackA - slackB;
    }
    if (totB !== totA) return totB - totA;
    return minSeats(a) - minSeats(b);
  })
    // Secondary copies of a merged game (admin marked them as duplicates of a primary) never get
    // their own table-forming pass — the primary's pass below books up to `copies` concurrent
    // tables to cover all of them at once.
    .filter((g) => !g.groupId || g.groupId === g.id);

  let tableNumber = existingTables.length
    ? Math.max(...existingTables.map((t) => t.tableNumber)) + 1
    : 1;

  for (const game of sorted) {
    // How many physical copies of this game exist — more than 1 only when the admin merged
    // duplicate entries together; lets that many tables of it run at the same time.
    const copies = games.filter((g) => (g.groupId ?? g.id) === game.id).length || 1;
    // The game can't be played before its owner has brought the physical copy to the venue, nor
    // after they've left with it — one window per copy/owner in the group (usually just one).
    // `lendable` carries whether that owner is OK with a table running without them seated.
    const ownerWindows = games
      .filter((g) => (g.groupId ?? g.id) === game.id)
      .map((g) => {
        const owner = players.find((p) => p.id === g.ownerPlayerId);
        return owner ? { start: owner.arrivalTime, end: owner.departureTime, ownerId: owner.id, lendable: !!g.lendable } : null;
      })
      .filter((w): w is { start: string; end: string; ownerId: string; lendable: boolean } => !!w);

    const offered = offeredByGame.get(game.id) ?? new Set<string>();
    // Every existing (non-cancelled) window this exact game is already booked into — further
    // tables for it can't overlap beyond the number of physical copies available.
    const gameWindows: { startTime: string; endTime: string }[] = existingTables
      .filter((t) => t.gameId === game.id && t.status !== 'cancelled')
      .map((t) => ({ startTime: t.startTime, endTime: t.endTime }));

    // 1. Extend still-open tables — the algorithm's and the ones owners posted — with any fresh voter who fits the window
    // already fixed for that table — never changes its time. A table that is already CONFIRMED but has free places
    // counts too: the late voter is OFFERED a place and has to accept it like everybody else, never seated without asking.
    const openTables = existingTables.filter(
      (t) => t.gameId === game.id && (t.status === 'recommended' || t.status === 'confirmed') && t.playerIds.length < game.maxPlayers
    );
    for (const ot of openTables) {
      const known = new Set([...(ot.candidateIds ?? []), ...(ot.queuedIds ?? []), ...ot.playerIds, ...(ot.rejectedIds ?? [])]);
      // A posted table is offered to the interested people like any other, but not to someone already seated at another
      // table of this game (unless they said they would join a second one): they have their table for it.
      const seatedElsewhere = (p: Player) => ot.postedByOwner &&
        existingTables.some((o) => o.id !== ot.id && o.gameId === game.id && o.status !== 'cancelled' && o.playerIds.includes(p.id)) &&
        !(p.repeatGameIds ?? []).includes(game.id);
      const fresh = players.filter((p) =>
        p.interests[game.id] === 'yes' && !known.has(p.id) && !seatedElsewhere(p) &&
        isAvailable(p, ot.startTime, ot.endTime, busyMap.get(p.id) ?? [], bufferMinutes)
      );
      if (fresh.length === 0) continue;
      if (ot.awaitingExplainer) {
        // Still waiting on an explainer: a newcomer who can explain the game is asked to as well; the rest queue up
        const declined = declinedExplainers.get(game.id);
        const asExplainers = fresh.filter((p) => p.canExplain.includes(game.id) && !declined?.has(p.id));
        const asPlayers = fresh.filter((p) => !asExplainers.includes(p));
        candidateUpdates.push({
          tableId: ot.id,
          ...(asExplainers.length > 0 && { candidateIds: [...(ot.candidateIds ?? []), ...asExplainers.map((p) => p.id)] }),
          ...(asPlayers.length > 0 && { queuedIds: [...(ot.queuedIds ?? []), ...asPlayers.map((p) => p.id)] }),
        });
      } else {
        candidateUpdates.push({ tableId: ot.id, candidateIds: [...(ot.candidateIds ?? []), ...fresh.map((p) => p.id)] });
      }
      fresh.forEach((p) => offered.add(p.id));
    }

    // 2. Group the remaining fresh voters into brand-new recommended table(s).
    while (true) {
      const eligibleForAnotherTable = (p: Player) => !offered.has(p.id) || (p.repeatGameIds ?? []).includes(game.id);
      const interested = players.filter((p) => p.interests[game.id] === 'yes' && eligibleForAnotherTable(p));
      if (interested.length < minSeats(game)) break;

      // Whoever arrives earliest goes first — a late arrival shouldn't get pulled ahead of
      // someone who's been free since the morning, which would needlessly delay the table.
      const byFlexibility = [...interested].sort((a, b) => {
        const arrivalA = toMinutes(a.arrivalTime);
        const arrivalB = toMinutes(b.arrivalTime);
        if (arrivalA !== arrivalB) return arrivalA - arrivalB;
        const busyA = (busyMap.get(a.id) ?? []).length;
        const busyB = (busyMap.get(b.id) ?? []).length;
        if (busyA !== busyB) return busyA - busyB;
        return windowDuration(b.arrivalTime, b.departureTime) - windowDuration(a.arrivalTime, a.departureTime);
      });

      interface GroupResult {
        group: Player[];
        window: { start: string; end: string };
        explainer: Player;
      }

      // Builds a group by adding candidates one at a time in priority order, skipping anyone
      // who'd break the shared window for whoever's already locked in — instead of requiring the
      // whole top-N by priority to ALL be simultaneously free (one incompatible voter used to sink
      // every group containing them, even when swapping just that one person out would've worked).
      function buildGreedy(pool: Player[], seed: Player[], minSize: number, maxSize: number): { group: Player[]; window: { start: string; end: string } } | null {
        let group = [...seed];
        let window: { start: string; end: string } | null = null;
        if (group.length) {
          window = findEarliestWindow(group, game, bufferMinutes, busyMap, physicalTables, occupiedTables, gameWindows, copies, ownerWindows);
          if (!window) return null;
        }
        for (const candidate of pool) {
          if (group.length >= maxSize) break;
          if (group.some((p) => p.id === candidate.id)) continue;
          const tentative = [...group, candidate];
          const found = findEarliestWindow(tentative, game, bufferMinutes, busyMap, physicalTables, occupiedTables, gameWindows, copies, ownerWindows);
          if (found) {
            group = tentative;
            window = found;
          }
        }
        if (group.length < minSize || !window) return null;
        return { group, window };
      }

      // The explainer always sits at the table, so every group is seeded with someone who can
      // explain the game; keeps whichever seed grows the biggest compatible group.
      function tryFindGroup(pool: Player[], minSize: number, maxSize: number): GroupResult | null {
        if (pool.length < minSize) return null;
        const declined = declinedExplainers.get(game.id);
        const explainerSeeds = pool.filter((p) => p.canExplain.includes(game.id) && !declined?.has(p.id));

        let best: GroupResult | null = null;
        for (const seed of explainerSeeds) {
          const built = buildGreedy(pool, [seed], minSize, maxSize);
          if (!built) continue;
          if (!best || built.group.length > best.group.length ||
            (built.group.length === best.group.length && toMinutes(built.window.start) < toMinutes(best.window.start))) {
            best = { group: built.group, window: built.window, explainer: seed };
          }
        }
        return best;
      }

      const best = tryFindGroup(byFlexibility, minSeats(game), game.maxPlayers);
      if (!best) break;
      const { group, window, explainer } = best;

      const declined = declinedExplainers.get(game.id);
      // Everyone in the group who can explain the game is asked at the same time (the first to accept takes the table);
      // the rest wait until one of them has.
      const explainerPool = group.filter((p) => p.canExplain.includes(game.id) && !declined?.has(p.id));
      proposals.push({
        gameId: game.id,
        gameName: game.name,
        startTime: window.start,
        endTime: window.end,
        explainerId: explainer.id, // provisional: whoever accepts first becomes the explainer
        playerIds: [],
        // Explainer first: without someone to explain it nothing else about the table matters, so only the people who
        // can explain it are offered it now. The rest wait in the queue and are offered it once one of them accepts
        // (and that explainer also plays: they take a seat like everyone else).
        candidateIds: explainerPool.map((p) => p.id),
        queuedIds: group.filter((p) => !explainerPool.includes(p)).map((p) => p.id),
        awaitingExplainer: true,
        rejectedIds: [],
        status: 'recommended',
        isManuallyEdited: false,
        batchNumber,
        tableNumber: tableNumber++,
      });
      occupiedTables.push({ startTime: window.start, endTime: window.end });
      gameWindows.push({ startTime: window.start, endTime: window.end });
      group.forEach((p) => offered.add(p.id));
    }
  }

  return { proposals, candidateUpdates };
}

/** What to do with a table that is waiting on explainers who may no longer be able to explain it. */
export type WaitingTableReview =
  | { tableId: string; action: 'cancel' }
  | { tableId: string; action: 'update'; explainerId: string; candidateIds: string[] };

/**
 * Looks at every recommended table still waiting for someone to confirm they explain it and checks each person it was
 * offered to can still do it: still at the event, still wants the game and can explain it, and isn't now busy with
 * another table at that time (e.g. they accepted one). People who can't are dropped from the offer; with nobody left
 * the table is cancelled right away, so it doesn't sit there waiting for an explainer who can't come.
 */
export function reviewWaitingTables(players: Player[], tables: Table[], bufferMinutes: number): WaitingTableReview[] {
  const reviews: WaitingTableReview[] = [];
  const canStillExplain = (id: string, t: Table): boolean => {
    const p = players.find((x) => x.id === id);
    return !!p && p.interests[t.gameId] === 'yes' && p.canExplain.includes(t.gameId) &&
      isAvailable(p, t.startTime, t.endTime, getBusyWindows(p.id, tables.filter((o) => o.id !== t.id)), bufferMinutes);
  };

  for (const t of tables) {
    if (t.status !== 'recommended' || t.postedByOwner || !t.awaitingExplainer) continue;
    const pool = t.candidateIds ?? [];
    const stillAble = pool.filter((id) => canStillExplain(id, t));
    if (stillAble.length === 0) reviews.push({ tableId: t.id, action: 'cancel' });
    else if (stillAble.length !== pool.length) {
      reviews.push({ tableId: t.id, action: 'update', explainerId: stillAble.includes(t.explainerId) ? t.explainerId : stillAble[0], candidateIds: stillAble });
    }
  }
  return reviews;
}

export interface IdleGap {
  playerId: string;
  playerName: string;
  start: string;
  end: string;
}

/**
 * Reports the free windows each player has (arrival→departure minus any non-cancelled table
 * they're seated at and minus scheduled breaks like lunch) — surfaced to the admin so they can
 * spot and manually fix idle stretches the algorithm couldn't fill on its own.
 */
export function computeIdleGaps(
  players: Player[],
  tables: Table[],
  breaks: { start: string; end: string }[] = [],
  minGapMinutes = 60
): IdleGap[] {
  const gaps: IdleGap[] = [];
  const breakWindows = breaks.map((b) => ({ start: toMinutes(b.start), end: toMinutes(b.end) }));
  for (const p of players) {
    const busy = [
      ...tables.filter((t) => t.playerIds.includes(p.id) && t.status !== 'cancelled')
        .map((t) => ({ start: toMinutes(t.startTime), end: toMinutes(t.endTime) })),
      ...breakWindows,
    ].sort((a, b) => a.start - b.start);

    let cursor = toMinutes(p.arrivalTime);
    const depart = toMinutes(p.departureTime);
    for (const b of busy) {
      if (b.start > cursor && b.start - cursor >= minGapMinutes) {
        gaps.push({ playerId: p.id, playerName: p.name, start: toTimeString(cursor), end: toTimeString(b.start) });
      }
      cursor = Math.max(cursor, b.end);
    }
    if (depart > cursor && depart - cursor >= minGapMinutes) {
      gaps.push({ playerId: p.id, playerName: p.name, start: toTimeString(cursor), end: toTimeString(depart) });
    }
  }
  return gaps;
}
