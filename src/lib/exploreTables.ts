import type { Game, Player, Table } from './types';
import { isOfferFor, isPostedOfferFor } from './offers';
import { hasOpenSeat, hasWaitingSeat, isFirmTable, missingToConfirm, seatOptionFor, type SeatOption } from './freeSeats';
import { isInTable } from './explainOnly';
import { isTentative } from './registration';
import { toMinutes } from './timeUtils';

/**
 * "Explorar mesas": every table of the event in one place, as one person sees it. This decides, for each table, where it is in its
 * life (se arma → confirmada → jugando → terminó), how it is called in plain words, which filters it belongs to and what the person
 * can do about it. Pure: the page gives it the data and the clock.
 */

/** The filters of the screen. A table can belong to several (a confirmed table you play is "confirmed" and "mine"). */
export type ExploreChip =
  | 'for-you' | 'all' | 'mine'
  | 'recommended' | 'posted' | 'confirmed' | 'playing' | 'free'
  | 'rejected' | 'done';

/** The order they are shown in: what needs you first, then the state of the tables, then the ones put aside. */
export const EXPLORE_CHIPS: { key: ExploreChip; label: string }[] = [
  { key: 'for-you', label: 'Para vos' },
  { key: 'all', label: 'Todas' },
  { key: 'mine', label: 'Mías' },
  { key: 'recommended', label: 'Recomendadas' },
  { key: 'posted', label: 'Postuladas' },
  { key: 'confirmed', label: 'Confirmadas' },
  { key: 'playing', label: 'En curso' },
  { key: 'free', label: 'Con lugar' },
  { key: 'rejected', label: 'Rechazadas' },
  { key: 'done', label: 'Terminadas' },
];

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
 * Every table the person can see (cancelled ones are gone), with everything the screen needs. `started` says whether a table's hour has
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
    if (table.status === 'cancelled') continue;
    const game = gameOf.get(table.gameId);
    const step = STEP_OF[table.status];
    const taken = table.playerIds.length;
    const max = game ? game.maxPlayers : null;
    const inIt = isInTable(table, viewer.id);
    const mine = inIt && step !== 'done';
    const rejected = !inIt && (table.rejectedIds ?? []).includes(viewer.id);
    const offered = !isTentative(viewer) && (isOfferFor(table, viewer.id, game) || isPostedOfferFor(table, viewer.id, game));
    // A posted table of a game they voted, with room, that fits — worth telling them about even if it wasn't offered
    const openForYou = !isTentative(viewer) && !!table.postedByOwner && table.status === 'recommended' && !inIt && !rejected
      && viewer.interests?.[table.gameId] === 'yes' && !!game && taken < game.maxPlayers && fits(table);
    const forYou = (offered || openForYou) && !rejected;
    const isStarted = started(table);
    const option = seatOptionFor({ viewer, table, game, tables, started: isStarted });
    const open = !!game && (hasOpenSeat(table, game, isStarted) || hasWaitingSeat(table, game, isStarted));

    const chips = new Set<ExploreChip>();
    if (forYou) chips.add('for-you');
    if (mine) chips.add('mine');
    if (rejected) chips.add('rejected');
    if (step === 'done') chips.add('done');
    if (step !== 'done' && !rejected) {
      chips.add('all');
      if (step === 'forming') chips.add(table.postedByOwner ? 'posted' : 'recommended');
      if (step === 'confirmed') chips.add('confirmed');
      if (step === 'playing') chips.add('playing');
      if (open) chips.add('free');
    }

    rows.push({
      table, game, step, taken, max,
      free: max == null ? 0 : Math.max(0, max - taken),
      missing: game ? missingToConfirm(table, game) : 0,
      mine, offered, rejected, openForYou, option,
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

/** The sentence under a table's progress bar. */
export function progressText(r: ExploreRow): string {
  const of = r.max != null ? `${r.taken} de ${r.max}` : `${r.taken}`;
  if (r.step === 'done') return `Jugaron ${r.taken}`;
  if (r.step === 'playing') return `${of} jugando`;
  if (r.step === 'confirmed') return r.free > 0 ? `${of} · quedan ${r.free}` : `${of} · completa`;
  if (r.table.awaitingExplainer) return 'Falta quien la explique';
  if (r.missing > 0) return `${of} · falta ${r.missing} para confirmarse`;
  return `${of} · ya tiene el mínimo, se confirma enseguida`;
}
