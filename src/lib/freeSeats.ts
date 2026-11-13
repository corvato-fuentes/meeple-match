import type { Game, Player, Table } from './types';
import { isTentative } from './registration';
import { isOfferFor } from './offers';
import { minSeats } from './seats';
import { isInTable } from './explainOnly';
import { toMinutes } from './timeUtils';

/**
 * A table that is set: confirmed, underway or played. One that is still waiting for players (recommended, or posted and not
 * full of people yet) is only a promise — somebody who accepted it can still take another table at that hour, and is asked
 * whether to leave it, so it must not make another table look "not free".
 */
export const isFirmTable = (t: Pick<Table, 'status'>): boolean =>
  t.status === 'confirmed' || t.status === 'in-progress' || t.status === 'completed';

/** Free places at a table: the game's maximum minus who is seated (0 when the game is not known). */
export function freeSeatsOf(t: Pick<Table, 'playerIds'>, game?: Pick<Game, 'maxPlayers'>): number {
  return game ? Math.max(0, game.maxPlayers - t.playerIds.length) : 0;
}

/** A confirmed table that has not started and still has a free place: somebody can still take it. */
export function hasOpenSeat(t: Pick<Table, 'status' | 'playerIds'>, game: Pick<Game, 'maxPlayers'> | undefined, started: boolean): boolean {
  return t.status === 'confirmed' && !started && freeSeatsOf(t, game) > 0;
}

/** A table still waiting for players (recommended by the algorithm or posted by its owner), not started, with room. */
export function hasWaitingSeat(t: Pick<Table, 'status' | 'playerIds'>, game: Pick<Game, 'maxPlayers'> | undefined, started: boolean): boolean {
  return t.status === 'recommended' && !started && freeSeatsOf(t, game) > 0;
}

/** How many more people a waiting table needs to be confirmed (0 when it already has them). */
export function missingToConfirm(t: Pick<Table, 'playerIds'>, game: Pick<Game, 'minPlayers'>): number {
  return Math.max(0, minSeats(game) - t.playerIds.length);
}

/** Why a free place is not for this person. */
export type BlockedReason =
  | { kind: 'in-table' }
  | { kind: 'rejected' }
  | { kind: 'tentative' }
  /** The table waits for someone to confirm they explain it; the person is queued and gets it offered after that. */
  | { kind: 'queued' }
  /** Already voted the game and the table is waiting: the system offers it when it fits everyone. */
  | { kind: 'voted' }
  | { kind: 'outside-hours'; arrival: string; departure: string }
  | { kind: 'has-game-table' };

/**
 * What a person can do about the free place of a table:
 *  - offered: the system already offered it to them (they answer Aceptar / Rechazar, like any other offer);
 *  - join: they can take it themselves — a confirmed table, or one its owner posted (their own explicit act, no offer to accept);
 *  - vote: a table the algorithm built that is still waiting; they have not voted the game, so voting is how it gets offered;
 *  - blocked: it is not for them, and why. A clash with another table of theirs is NOT a reason: taking it asks what to do with
 *    the other one.
 */
export type SeatOption =
  | { kind: 'offered' }
  | { kind: 'join' }
  | { kind: 'vote' }
  | { kind: 'blocked'; reason: BlockedReason };

/** Null when there is nothing to show: no viewer, unknown game, the table is not open (full, started, cancelled…). */
export function seatOptionFor(args: {
  viewer: Player | null; table: Table; game?: Game; tables: Table[]; started: boolean;
}): SeatOption | null {
  const { viewer, table, game, tables, started } = args;
  if (!viewer || !game || !(hasOpenSeat(table, game, started) || hasWaitingSeat(table, game, started))) return null;
  const blocked = (reason: BlockedReason): SeatOption => ({ kind: 'blocked', reason });

  if (isInTable(table, viewer.id)) return blocked({ kind: 'in-table' }); // seated, or the explainer who only explains
  if ((table.rejectedIds ?? []).includes(viewer.id)) return blocked({ kind: 'rejected' });
  if (isTentative(viewer)) return blocked({ kind: 'tentative' });
  if (table.awaitingExplainer && (table.queuedIds ?? []).includes(viewer.id)) return blocked({ kind: 'queued' });
  if (isOfferFor(table, viewer.id, game)) return { kind: 'offered' };

  const hasTableOfGame = tables.some((o) => o.id !== table.id && o.gameId === table.gameId && o.status !== 'cancelled' && o.playerIds.includes(viewer.id));
  if (hasTableOfGame && !(viewer.repeatGameIds ?? []).includes(table.gameId)) return blocked({ kind: 'has-game-table' });
  if (toMinutes(table.startTime) < toMinutes(viewer.arrivalTime) || toMinutes(table.endTime) > toMinutes(viewer.departureTime)) {
    return blocked({ kind: 'outside-hours', arrival: viewer.arrivalTime, departure: viewer.departureTime });
  }

  if (table.status === 'confirmed' || table.postedByOwner) return { kind: 'join' };
  return viewer.interests?.[table.gameId] === 'yes' ? blocked({ kind: 'voted' }) : { kind: 'vote' };
}

/** The words for a blocked place, as the person reads them. */
export function blockedMessage(reason: BlockedReason, table: Pick<Table, 'startTime' | 'endTime'>): string {
  switch (reason.kind) {
    case 'in-table': return 'Ya estás en esta mesa.';
    case 'rejected': return 'La rechazaste. Si cambiaste de idea, podés volver a considerarla.';
    case 'tentative': return 'Todavía sos indeciso: confirmá tu inscripción (con el comprobante) para sumarte a una mesa.';
    case 'queued': return 'Está esperando que alguien confirme que la explica. Cuando alguien lo haga, te la ofrecemos.';
    case 'voted': return 'Ya votaste este juego. Esta mesa espera jugadores: cuando le quede bien a todos, te la ofrecemos.';
    case 'outside-hours': return `No te queda el horario: la mesa es de ${table.startTime} a ${table.endTime} y vos estás de ${reason.arrival} a ${reason.departure}.`;
    case 'has-game-table': return 'Ya estás en otra mesa de este juego. Para sumarte a una segunda, tenés que haber dicho que jugarías otra.';
  }
}
