import type { Game, Table } from './types';
import { toMinutes } from './timeUtils';

/**
 * Is this table an offer waiting for the player's answer? Tables the algorithm built are offered to people who still
 * have to accept — also once the table is already confirmed and has free places (somebody who votes for the game later
 * is offered one of them, never seated without asking). Not an offer: tables the player is already seated at or
 * rejected, owner-posted ones (those are joined directly), tables waiting for their explainer when the player is only
 * queued, and — when the game is known — tables with no place left.
 */
export function isOfferFor(t: Table, playerId: string, game?: Pick<Game, 'maxPlayers'>): boolean {
  if (t.postedByOwner || (t.status !== 'recommended' && t.status !== 'confirmed')) return false;
  if (!(t.candidateIds ?? []).includes(playerId)) return false;
  if (t.playerIds.includes(playerId) || (t.rejectedIds ?? []).includes(playerId)) return false;
  if (game && t.playerIds.length >= game.maxPlayers) return false;
  return true;
}

/**
 * The same for a table an owner posted: the people who voted its game and fit its slot are offered it (they are in its
 * `candidateIds`) and answer Aceptar / Rechazar; everyone else can still join it directly.
 */
export function isPostedOfferFor(t: Table, playerId: string, game?: Pick<Game, 'maxPlayers'>): boolean {
  if (!t.postedByOwner || (t.status !== 'recommended' && t.status !== 'confirmed')) return false;
  if (!(t.candidateIds ?? []).includes(playerId)) return false;
  if (t.playerIds.includes(playerId) || (t.rejectedIds ?? []).includes(playerId)) return false;
  if (game && t.playerIds.length >= game.maxPlayers) return false;
  return true;
}

/**
 * Tables that are already full but still list people they were offered to: those who didn't make it. A full table has
 * nothing left to offer, so its offer is withdrawn (and handed out again if a seat frees up later).
 */
export function tablesWithStaleOffers(tables: Table[], gameOf: (id: string) => Pick<Game, 'maxPlayers'> | undefined): Table[] {
  return tables.filter((t) => {
    if (t.status !== 'recommended' && t.status !== 'confirmed') return false;
    const game = gameOf(t.gameId);
    if (!game || t.playerIds.length < game.maxPlayers) return false;
    return (t.candidateIds ?? []).length > 0 || (t.queuedIds ?? []).length > 0;
  });
}

/** Any table waiting for the player's answer, recommended by the algorithm or posted by an owner. */
export const hasOfferFor = (t: Table, playerId: string, game?: Pick<Game, 'maxPlayers'>): boolean =>
  isOfferFor(t, playerId, game) || isPostedOfferFor(t, playerId, game);

/**
 * The other tables of the same game that are also waiting for the player's answer — asked about right after they accept
 * one ("You were also offered this other one: do you join it too?"), in time order.
 */
export function otherOffersForGame(
  tables: Table[], playerId: string, gameId: string, exceptTableId: string, gameOf: (id: string) => Pick<Game, 'maxPlayers'> | undefined
): Table[] {
  return tables
    .filter((t) => t.id !== exceptTableId && t.gameId === gameId && hasOfferFor(t, playerId, gameOf(t.gameId)))
    .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
}
