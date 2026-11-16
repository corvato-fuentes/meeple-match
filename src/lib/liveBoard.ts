import type { Game, Player, Table } from './types';
import { isTentative } from './registration';
import { occupiedWindow } from './explainOnly';
import { toMinutes, toTimeString } from './timeUtils';
import { sameGameOverlaps } from './tableAlgorithm';

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

// ── Stage B: the state of the tables themselves ──────────────────────────────────────────────────────────

/** "Por empezar" shows the confirmed tables starting within this many minutes (the rest of the day isn't what matters now). */
export const UPCOMING_MINUTES = 60;
/** A table nobody confirmed is only worth showing when it is about to start. */
export const UNCONFIRMED_MINUTES = 30;

export type LiveKind =
  /** Underway. */
  | 'running'
  /** Underway and past its end time. */
  | 'overtime'
  /** Confirmed and past its start time, but nobody started it. */
  | 'late'
  /** Confirmed and its whole time has passed with nobody marking it: was it played or not? */
  | 'past'
  /** Confirmed, starts within the hour. */
  | 'upcoming'
  /** Never reached its minimum of people, and it is about to start (or should have). */
  | 'unconfirmed';

export interface LiveTable {
  table: Table;
  kind: LiveKind;
  /** Minutes past the start (`late`, `unconfirmed` once started) or the end (`overtime`, `past`); until the start for `upcoming`. */
  minutes: number;
  /** Everyone the table holds: seated, plus an explainer who only explains. */
  memberIds: string[];
  /** Members nobody has confirmed as there. */
  missingIds: string[];
  /** Needs the organizers' eyes now: it should have started, or it should have ended. */
  attention: boolean;
}

/** The people a table holds: the ones seated, and an explainer who only explains (not seated, but expected). */
export function membersOf(t: Table): string[] {
  const ids = [...t.playerIds];
  if (t.explainerId && !ids.includes(t.explainerId) && occupiedWindow(t, t.explainerId)) ids.push(t.explainerId);
  return ids;
}

/**
 * The tables to run the event with: the ones being played, the ones that should be and aren't, the ones about to start and the ones
 * nobody confirmed that are about to. Running ones first; the rest by hour.
 */
export function liveTables(tables: Table[], present: Set<string>, nowMin: number): LiveTable[] {
  const out: LiveTable[] = [];
  for (const table of tables) {
    const start = toMinutes(table.startTime);
    const end = toMinutes(table.endTime);
    let kind: LiveKind | null = null;
    let minutes = 0;
    if (table.status === 'in-progress') {
      kind = end <= nowMin ? 'overtime' : 'running';
      minutes = kind === 'overtime' ? nowMin - end : nowMin - start;
    } else if (table.status === 'confirmed') {
      if (end <= nowMin) { kind = 'past'; minutes = nowMin - end; }
      else if (start <= nowMin) { kind = 'late'; minutes = nowMin - start; }
      else if (start - nowMin <= UPCOMING_MINUTES) { kind = 'upcoming'; minutes = start - nowMin; }
    } else if (table.status === 'recommended' && !table.awaitingExplainer && table.playerIds.length > 0 && end > nowMin && start - nowMin <= UNCONFIRMED_MINUTES) {
      kind = 'unconfirmed';
      minutes = nowMin - start;
    }
    if (!kind) continue;
    const memberIds = membersOf(table);
    out.push({
      table, kind, minutes, memberIds, missingIds: memberIds.filter((id) => !present.has(id)),
      attention: kind === 'late' || kind === 'past' || kind === 'overtime' || (kind === 'unconfirmed' && start <= nowMin),
    });
  }
  const rank: Record<LiveKind, number> = { overtime: 0, late: 1, unconfirmed: 2, running: 3, upcoming: 4, past: 5 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || toMinutes(a.table.startTime) - toMinutes(b.table.startTime));
}

/**
 * What would clash if a table ran [start, end) instead of its own time: people it holds who are in another live table then, and
 * other tables of the same game when the game has no spare copy. Both empty means it is safe. Only to warn: nothing is blocked.
 */
export function timeChangeClashes(args: {
  table: Table; start: string; end: string; tables: Table[]; copies: number; bufferMinutes: number;
}): { people: { playerId: string; table: Table }[]; sameGame: Table[] } {
  const { table, start, end, tables, copies, bufferMinutes } = args;
  const s = toMinutes(start);
  const e = toMinutes(end);
  const people: { playerId: string; table: Table }[] = [];
  for (const id of membersOf(table)) {
    for (const other of tables) {
      if (other.id === table.id || !isLive(other)) continue;
      const w = occupiedWindow(other, id);
      if (w && toMinutes(w.start) < e && toMinutes(w.end) > s) people.push({ playerId: id, table: other });
    }
  }
  const sameGame = sameGameOverlaps({ tables, table, start, end, bufferMinutes, gameCopies: copies });
  return { people, sameGame };
}

/** "HH:MM" plus minutes, never past the end of the day. */
export const addMinutes = (time: string, delta: number): string => toTimeString(Math.min(23 * 60 + 59, toMinutes(time) + delta));
