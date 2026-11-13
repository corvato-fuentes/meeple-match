import type { Game, Player, Table } from './types';
import { isTentative } from './registration';
import { isOfferFor } from './offers';
import { toMinutes } from './timeUtils';

/** Free places at a table: the game's maximum minus who is seated (0 when the game is not known). */
export function freeSeatsOf(t: Pick<Table, 'playerIds'>, game?: Pick<Game, 'maxPlayers'>): number {
  return game ? Math.max(0, game.maxPlayers - t.playerIds.length) : 0;
}

/** A confirmed table that has not started and still has a free place: somebody can still take it. */
export function hasOpenSeat(t: Pick<Table, 'status' | 'playerIds'>, game: Pick<Game, 'maxPlayers'> | undefined, started: boolean): boolean {
  return t.status === 'confirmed' && !started && freeSeatsOf(t, game) > 0;
}

/**
 * What a person can do about the free place of a confirmed table:
 *  - 'offered': the system already offered it to them (they answer Aceptar / Rechazar, like any other offer);
 *  - 'join': they can take it themselves (their own explicit act, so there is no offer to accept);
 *  - null: nothing — it is not for them (they are in it, declined it, are "indecisos", already have a table of that game
 *    and did not say they would play a second one, or it falls outside the hours they are at the event). A clash with
 *    another table of theirs is NOT a reason to hide it: taking it asks what to do with the other one.
 */
export type SeatChance = 'offered' | 'join' | null;

export function seatChanceFor(args: {
  viewer: Player | null; table: Table; game?: Game; tables: Table[]; started: boolean;
}): SeatChance {
  const { viewer, table, game, tables, started } = args;
  if (!viewer || !game || !hasOpenSeat(table, game, started)) return null;
  if (isTentative(viewer) || table.playerIds.includes(viewer.id) || (table.rejectedIds ?? []).includes(viewer.id)) return null;
  if (isOfferFor(table, viewer.id, game)) return 'offered';
  const hasTableOfGame = tables.some((o) => o.id !== table.id && o.gameId === table.gameId && o.status !== 'cancelled' && o.playerIds.includes(viewer.id));
  if (hasTableOfGame && !(viewer.repeatGameIds ?? []).includes(table.gameId)) return null;
  if (toMinutes(table.startTime) < toMinutes(viewer.arrivalTime) || toMinutes(table.endTime) > toMinutes(viewer.departureTime)) return null;
  return 'join';
}
