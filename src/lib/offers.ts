import type { Game, Table } from './types';

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
