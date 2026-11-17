import type { Game, GameComplexity, Player, Table } from './types';
import { isOfferFor, isPostedOfferFor } from './offers';
import { hasOpenSeat, hasWaitingSeat, isFirmTable, missingToConfirm, seatOptionFor, type SeatOption } from './freeSeats';
import { isExplainOnly, isInTable } from './explainOnly';
import { isTentative } from './registration';
import { estimateAtCurrentSeats, estimatedDuration, overlaps } from './tableAlgorithm';
import { toMinutes, toTimeString } from './timeUtils';

/**
 * "Explorar mesas": every table of the event in one place, as one person sees it. This decides, for each table, where it is in its
 * life (armando → confirmada → jugando → terminó), how it is called in plain words, which filters it belongs to and what the person
 * can do about it. Pure: the page gives it the data and the clock.
 */

/**
 * The filters of the screen: only what changes what the person does. What is waiting for them, the tables of the games they voted (the
 * ones they are in included), the ones of games they never voted, the ones underway, the ones they turned down. The state of a table
 * (armando, confirmada, a posted one) is on its card, and "only with room" is a switch over "Todas", not a filter of its own.
 */
export type ExploreChip = 'for-you' | 'all' | 'unvoted' | 'playing' | 'rejected';

/** The order they are shown in: what needs you first. */
export const EXPLORE_CHIPS: { key: ExploreChip; label: string }[] = [
  { key: 'for-you', label: 'Para vos' },
  { key: 'all', label: 'Todas' },
  { key: 'unvoted', label: 'Sin votar' },
  { key: 'playing', label: 'En curso' },
  { key: 'rejected', label: 'Rechazadas' },
];

/**
 * The filters to show. "En curso" only means something from the day of the event (before it nothing is underway), and "Rechazadas"
 * only when they turned down some table. Finished tables are not shown anywhere: they are of no use to anyone.
 */
export function chipsFor(eventHasStarted: boolean, counts?: Pick<Record<ExploreChip, number>, 'rejected'>): { key: ExploreChip; label: string }[] {
  return EXPLORE_CHIPS.filter((c) => (c.key !== 'playing' || eventHasStarted) && (c.key !== 'rejected' || (counts?.rejected ?? 0) > 0));
}

/** Where a table is in its life: still gathering people, set, being played, finished. */
export type TableStep = 'forming' | 'confirmed' | 'playing' | 'done';

export interface ExploreRow {
  table: Table;
  game: Game | undefined;
  step: TableStep;
  /** People at the table (seated), the game's maximum (null if the game is unknown), the places left and how many more it needs to be set. */
  taken: number;
  max: number | null;
  free: number;
  missing: number;
  /** The person is at the table (seated, or the explainer who only explains) and it is not over. */
  mine: boolean;
  /** The table is waiting for their answer: offered by the algorithm, or posted by an owner and offered to them. */
  offered: boolean;
  /** They turned it down (and are not in it). */
  rejected: boolean;
  /** An open posted table of a game they voted that fits them: it is for them even if nobody offered it. */
  openForYou: boolean;
  /** The table has a place that is still free (or one that is waiting to be filled) and has not started: someone could sit. */
  open: boolean;
  /** A game they never voted (and that wasn't offered to them): it lives only under "Sin votar", the one place where voting sits next to a table. */
  unvoted: boolean;
  /** What the person can do about its free place, as the rest of the app decides it (null when it isn't open). */
  option: SeatOption | null;
  /** How it is called, in plain words. */
  label: string;
  chips: Set<ExploreChip>;
}

const STEP_OF: Record<Table['status'], TableStep> = {
  recommended: 'forming', confirmed: 'confirmed', 'in-progress': 'playing', completed: 'done', cancelled: 'done',
};

/** The words for a table, for this person. */
function labelOf(args: { table: Table; step: TableStep; mine: boolean; offered: boolean; rejected: boolean; openForYou: boolean }): string {
  const { table, step, mine, offered, rejected, openForYou } = args;
  if (rejected) return 'La rechazaste';
  if (step === 'done') return 'Terminó';
  if (step === 'playing') return mine ? 'Jugando · estás en la mesa' : 'Jugando';
  if (step === 'confirmed') return mine ? 'Confirmada · vos jugás' : offered ? 'Hay lugar para vos' : 'Confirmada';
  // Still gathering people
  if (table.awaitingExplainer) return offered ? 'Buscamos quien la explique' : 'Esperando quien la explique';
  if (mine) return 'Anotado · falta gente';
  if (offered && !table.postedByOwner) return 'Te la proponemos';
  if (table.postedByOwner) return offered || openForYou ? 'Abierta, sumate' : 'Abierta';
  return 'Esperando gente';
}

/**
 * Every table the person can see, with everything the screen needs. Cancelled ones are gone, and so are the tables of a game they voted
 * "no me interesa" (and the ones of a game they never voted that they can't take anymore): they don't show in any filter (unless the person is already in that table, which is never hidden from them). `started` says whether a table's hour has
 * come: a table that started no longer takes people.
 */
export function exploreRows(args: {
  viewer: Player; tables: Table[]; games: Game[]; bufferMinutes: number; started: (t: Table) => boolean;
}): ExploreRow[] {
  const { viewer, tables, games, bufferMinutes, started } = args;
  const gameOf = new Map(games.map((g) => [g.id, g]));
  // What holds the person's hours: only tables that are set count to tell whether a posted table fits (joining one that is
  // still waiting asks what to do with the other)
  const myFirm = tables.filter((t) => isFirmTable(t) && isInTable(t, viewer.id));
  const fits = (t: Table): boolean => {
    if (toMinutes(t.startTime) < toMinutes(viewer.arrivalTime) + bufferMinutes || toMinutes(t.endTime) > toMinutes(viewer.departureTime)) return false;
    return myFirm.every((m) => toMinutes(m.endTime) + bufferMinutes <= toMinutes(t.startTime) || toMinutes(t.endTime) + bufferMinutes <= toMinutes(m.startTime));
  };

  const rows: ExploreRow[] = [];
  for (const table of tables) {
    if (table.status === 'cancelled' || table.status === 'completed') continue; // finished tables are shown nowhere
    const inIt = isInTable(table, viewer.id);
    if (!inIt && viewer.interests?.[table.gameId] === 'no') continue;
    const game = gameOf.get(table.gameId);
    const step = STEP_OF[table.status];
    const taken = table.playerIds.length;
    const max = game ? game.maxPlayers : null;
    const mine = inIt;
    const rejected = !inIt && (table.rejectedIds ?? []).includes(viewer.id);
    const offered = !isTentative(viewer) && (isOfferFor(table, viewer.id, game) || isPostedOfferFor(table, viewer.id, game));
    // A posted table of a game they voted, with room, that fits — worth telling them about even if it wasn't offered
    const openForYou = !isTentative(viewer) && !!table.postedByOwner && table.status === 'recommended' && !inIt && !rejected
      && viewer.interests?.[table.gameId] === 'yes' && !!game && taken < game.maxPlayers && fits(table);
    const forYou = (offered || openForYou) && !rejected;
    const isStarted = started(table);
    const option = seatOptionFor({ viewer, table, game, tables, started: isStarted });
    // A game they never voted is not part of their tables: it only shows (under "Sin votar") while they could still take it
    const unvoted = !inIt && !rejected && !forYou && viewer.interests?.[table.gameId] == null;
    if (unvoted && !(option && (option.kind === 'vote' || option.kind === 'join'))) continue;
    const open = !!game && (hasOpenSeat(table, game, isStarted) || hasWaitingSeat(table, game, isStarted));

    const chips = new Set<ExploreChip>();
    if (unvoted) chips.add('unvoted');
    else if (forYou) chips.add('for-you');
    if (rejected) chips.add('rejected');
    if (!rejected && !unvoted) {
      chips.add('all');
      if (step === 'playing') chips.add('playing');
    }

    rows.push({
      table, game, step, taken, max,
      free: max == null ? 0 : Math.max(0, max - taken),
      missing: game ? missingToConfirm(table, game) : 0,
      mine, offered, rejected, openForYou, unvoted, open, option,
      label: labelOf({ table, step, mine, offered, rejected, openForYou }),
      chips,
    });
  }
  return rows.sort((a, b) => toMinutes(a.table.startTime) - toMinutes(b.table.startTime) || a.table.gameName.localeCompare(b.table.gameName));
}

/** How many tables each filter holds (every filter is always listed, with 0 when it is empty). */
export function chipCounts(rows: ExploreRow[]): Record<ExploreChip, number> {
  const counts = Object.fromEntries(EXPLORE_CHIPS.map((c) => [c.key, 0])) as Record<ExploreChip, number>;
  for (const r of rows) for (const c of r.chips) counts[c]++;
  return counts;
}

export const rowsFor = (rows: ExploreRow[], chip: ExploreChip): ExploreRow[] => rows.filter((r) => r.chips.has(chip));

/** The counter on the single "Explorar mesas" button: what is waiting for the person. */
export const attentionCount = (rows: ExploreRow[]): number => rows.filter((r) => r.chips.has('for-you')).length;

/** The words for how hard a game is. */
export const COMPLEXITY_LABEL: Record<GameComplexity, string> = { light: 'Liviano', medium: 'Intermedio', heavy: 'Pesado' };

/** How full the table is, in one short phrase ("2 de 4 · faltan 2 para confirmar"). */
export function seatsLine(r: Pick<ExploreRow, 'step' | 'taken' | 'max' | 'free' | 'missing' | 'table'>): string {
  const of = r.max != null ? `${r.taken} de ${r.max}` : `${r.taken}`;
  if (r.step === 'done') return `Jugaron ${r.taken}`;
  if (r.step === 'playing') return `${of} jugando`;
  if (r.step === 'confirmed') return r.free > 0 ? `${of} · ${r.free === 1 ? 'queda 1 lugar' : `quedan ${r.free} lugares`}` : `${of} · completa`;
  if (r.table.awaitingExplainer) return of;
  return r.missing > 0 ? `${of} · faltan ${r.missing} para confirmar` : `${of} · ya tiene el mínimo`;
}

/** Who explains it, short enough for the card's line; null when there is nothing to say. */
export function explainerLine(t: Pick<Table, 'awaitingExplainer' | 'explainerId' | 'explainerPlays'>, nameOf: (id: string) => string, viewerId: string): string | null {
  if (t.awaitingExplainer) return 'busca quien la explique';
  if (!t.explainerId) return null;
  const mine = t.explainerId === viewerId;
  if (isExplainOnly(t)) return mine ? 'la explicás vos y no jugás' : `${nameOf(t.explainerId)} la explica y no juega`;
  return mine ? 'la explicás vos' : `explica ${nameOf(t.explainerId)}`;
}

/**
 * How long the table lasts, for the detail: with the people it has now when it still has room (that is what it would take today),
 * and what it reserves; once every seat is taken, the full time. Null when the game is unknown.
 */
export function durationLine(t: Pick<Table, 'startTime' | 'endTime' | 'playerIds'>, game: Game | undefined): string | null {
  if (!game) return null;
  const today = estimateAtCurrentSeats(t, game);
  if (today) return `~${today.minutes} min con ${today.seats} jugadores (hasta las ${today.endTime}) · la mesa reserva hasta las ${t.endTime}`;
  return `~${estimatedDuration(game, game.maxPlayers)} min (hasta las ${t.endTime})`;
}

/**
 * The tables of the person's own that this one gets in the way of (the hour of one overlaps the other, buffer included): live ones they
 * are in, earliest first. Taking the table asks what to do with them.
 */
export function clashesOf(table: Table, viewer: Pick<Player, 'id'>, tables: Table[], bufferMinutes: number): Table[] {
  return tables
    .filter((m) => m.id !== table.id && (m.status === 'recommended' || m.status === 'confirmed' || m.status === 'in-progress') && isInTable(m, viewer.id))
    .filter((m) => overlaps(toTimeString(toMinutes(m.startTime) - bufferMinutes), toTimeString(toMinutes(m.endTime) + bufferMinutes), table.startTime, table.endTime))
    .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
}
