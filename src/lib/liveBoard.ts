import type { Game, Player, Table } from './types';
import { isTentative } from './registration';
import { occupiedWindow } from './explainOnly';
import { toMinutes } from './timeUtils';

/**
 * What the organizers need while the event is running ("En vivo"): which tables have a free place right now or soon, who is without a
 * table, and where each of them fits. Pure: the page gives it the clock (`nowMin`, minutes since midnight) and the data.
 */

/** A free gap shorter than this is not worth offering a table for. */
export const MIN_FREE_MINUTES = 30;
/** "Próximamente": people who will be free within this many minutes. */
export const SOON_MINUTES = 120;
/** Seating someone at a table that is running, or about to start within this many minutes, means they are there. */
export const PRESENT_IF_STARTS_WITHIN = 15;

/** Tables that still count for a person: waiting, confirmed or being played. Finished or cancelled ones do not. */
const isLive = (t: Pick<Table, 'status'>): boolean => t.status === 'recommended' || t.status === 'confirmed' || t.status === 'in-progress';

export interface FreeTable {
  table: Table;
  game: Game;
  taken: number;
  free: number;
  /** Started (or should have) and not over. Otherwise `startsInMin` says how long until it starts. */
  running: boolean;
  startsInMin: number;
  /** Still waiting for its players (not confirmed): people can be added, but it is not set yet. */
  waiting: boolean;
}

/**
 * Tables with a free place that are not over, running ones first and then by start time. A table still looking for its explainer
 * has nobody yet, so it is not offered. A table whose game is unknown can't say how many places it has and is left out.
 */
export function freeTables(tables: Table[], games: Game[], nowMin: number): FreeTable[] {
  const gameOf = new Map(games.map((g) => [g.id, g]));
  const rows: FreeTable[] = [];
  for (const table of tables) {
    if (!isLive(table) || table.awaitingExplainer) continue;
    const game = gameOf.get(table.gameId);
    if (!game) continue;
    if (toMinutes(table.endTime) <= nowMin) continue;
    const taken = table.playerIds.length;
    const free = game.maxPlayers - taken;
    if (free <= 0) continue;
    const start = toMinutes(table.startTime);
    rows.push({ table, game, taken, free, running: start <= nowMin, startsInMin: Math.max(0, start - nowMin), waiting: table.status === 'recommended' });
  }
  return rows.sort((a, b) => Number(b.running) - Number(a.running) || toMinutes(a.table.startTime) - toMinutes(b.table.startTime) || a.table.gameName.localeCompare(b.table.gameName));
}

/** The time ranges a player is held by live tables (seated, or explaining), earliest first. */
function heldWindows(player: Pick<Player, 'id'>, tables: Table[], ignoreTableId?: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (const t of tables) {
    if (!isLive(t) || t.id === ignoreTableId) continue;
    const w = occupiedWindow(t, player.id);
    if (w) out.push({ start: toMinutes(w.start), end: toMinutes(w.end) });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Can this player be put in this table: not already in it, and it doesn't clash with their other live tables. */
export function fitsPlayer(table: Table, player: Pick<Player, 'id'>, tables: Table[], ignoreTableId?: string): boolean {
  if (table.playerIds.includes(player.id)) return false;
  const s = toMinutes(table.startTime);
  const e = toMinutes(table.endTime);
  return heldWindows(player, tables, ignoreTableId).every((w) => e <= w.start || s >= w.end);
}

/** The tables with room this player could be put in (their vote on the game first; none that ends after they leave), not counting `ignoreTableId` (the one they leave). */
export function destinationsFor(player: Player, rows: FreeTable[], tables: Table[], ignoreTableId?: string): (FreeTable & { votedYes: boolean })[] {
  return rows
    .filter((r) => r.table.id !== ignoreTableId && player.interests[r.table.gameId] !== 'no' && !(r.table.rejectedIds ?? []).includes(player.id)
      // A table that ends after they leave is not for them
      && toMinutes(r.table.endTime) <= toMinutes(player.departureTime) && fitsPlayer(r.table, player, tables, ignoreTableId))
    .map((r) => ({ ...r, votedYes: player.interests[r.table.gameId] === 'yes' }))
    .sort((a, b) => Number(b.votedYes) - Number(a.votedYes) || Number(b.running) - Number(a.running) || toMinutes(a.table.startTime) - toMinutes(b.table.startTime));
}

/**
 * Where a person is regarding the venue. Without a door check-in the only thing known is what they said when registering:
 *  - `here`: an organizer confirmed they are there;
 *  - `unconfirmed`: their arrival time has passed, but nobody confirmed it;
 *  - `later`: they are not due yet.
 */
export type Presence = 'here' | 'unconfirmed' | 'later';

export interface FreePerson {
  player: Player;
  presence: Presence;
  /** When they have no table from (minutes): now for someone already free. */
  freeFrom: number;
  /** Until when they are free: their next table, or when they leave. */
  freeUntil: number;
  /** Tables with room that fit them, their vote first. */
  options: (FreeTable & { votedYes: boolean })[];
}

/**
 * People without a table. `now`: there and free at this moment. `soon`: free within the next `SOON_MINUTES` (arriving later, or
 * about to finish their table). Registered-as-undecided people have no place and are left out, and so is anyone who already left or
 * whose free time is too short to play.
 */
export function peopleWithoutTable(args: {
  players: Player[]; tables: Table[]; rows: FreeTable[]; present: Set<string>; nowMin: number;
}): { now: FreePerson[]; soon: FreePerson[] } {
  const { players, tables, rows, present, nowMin } = args;
  const now: FreePerson[] = [];
  const soon: FreePerson[] = [];
  for (const player of players) {
    if (isTentative(player)) continue;
    const arrival = toMinutes(player.arrivalTime);
    const departure = toMinutes(player.departureTime);
    if (departure <= nowMin) continue;
    const presence: Presence = present.has(player.id) ? 'here' : arrival <= nowMin ? 'unconfirmed' : 'later';
    // Walk forward from when they are around, skipping the tables that hold them
    let freeFrom = presence === 'here' ? nowMin : Math.max(nowMin, arrival);
    const held = heldWindows(player, tables);
    for (const w of held) if (w.start <= freeFrom && w.end > freeFrom) freeFrom = w.end;
    if (freeFrom >= departure) continue;
    const next = held.find((w) => w.start > freeFrom);
    const freeUntil = Math.min(departure, next ? next.start : departure);
    if (freeUntil - freeFrom < MIN_FREE_MINUTES) continue;
    const isNow = freeFrom <= nowMin;
    if (!isNow && freeFrom - nowMin > SOON_MINUTES) continue;
    const options = destinationsFor(player, rows, tables).filter((o) => toMinutes(o.table.endTime) > freeFrom && toMinutes(o.table.startTime) < freeUntil);
    (isNow ? now : soon).push({ player, presence, freeFrom, freeUntil, options });
  }
  const order = { here: 0, unconfirmed: 1, later: 2 } as const;
  now.sort((a, b) => order[a.presence] - order[b.presence] || toMinutes(a.player.arrivalTime) - toMinutes(b.player.arrivalTime) || a.player.name.localeCompare(b.player.name));
  soon.sort((a, b) => a.freeFrom - b.freeFrom || a.player.name.localeCompare(b.player.name));
  return { now, soon };
}

/** The live tables a person is seated at (or explaining) that are not over yet, for moving or taking them out. */
export function tablesOf(player: Pick<Player, 'id'>, tables: Table[], nowMin: number): Table[] {
  return tables.filter((t) => isLive(t) && toMinutes(t.endTime) > nowMin && occupiedWindow(t, player.id) !== null)
    .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
}

/** Should seating someone at this table also count as them being at the venue. */
export const impliesPresence = (row: Pick<FreeTable, 'running' | 'startsInMin'>): boolean => row.running || row.startsInMin <= PRESENT_IF_STARTS_WITHIN;
