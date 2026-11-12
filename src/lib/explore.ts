import { overlaps } from './tableAlgorithm';
import { toMinutes, toTimeString } from './timeUtils';
import type { Game, Table } from './types';

export interface ExploreEntry {
  table: Table;
  /** The tables of the player's own that this one clashes with (buffer included), earliest first — more than one for a long table. */
  clashes: Table[];
  /** The player turned this table down: it is kept apart from the rest and not counted. */
  rejected: boolean;
}

/**
 * Tables of games the player wants to play that they can't be offered because their agenda is full at that time: the ones
 * that clash with a table they hold. Nothing here moves anybody — the player looks, and decides whether to swap.
 *
 * A table counts when: it is waiting for players or confirmed with a free seat; it is not waiting for someone to confirm they
 * explain it; the player voted its game yes; they aren't in it, and don't already have a table
 * of the game (unless they said they'd play a second one); it falls inside the hours they are at the event; and it clashes with
 * a table of theirs that hasn't finished. Soonest first.
 */
export function tablesToExplore(args: {
  playerId: string;
  arrivalTime: string;
  departureTime: string;
  interests: Record<string, 'yes' | 'no'>;
  repeatGameIds: string[];
  tables: Table[];
  games: Pick<Game, 'id' | 'maxPlayers'>[];
  bufferMinutes: number;
}): ExploreEntry[] {
  const { playerId, arrivalTime, departureTime, interests, repeatGameIds, tables, games, bufferMinutes } = args;
  const mine = tables.filter((t) => (t.status === 'recommended' || t.status === 'confirmed' || t.status === 'in-progress') && t.playerIds.includes(playerId));
  const from = toMinutes(arrivalTime) + bufferMinutes;
  const to = toMinutes(departureTime);
  const out: ExploreEntry[] = [];
  for (const t of tables) {
    if (t.status !== 'recommended' && t.status !== 'confirmed') continue;
    if (t.awaitingExplainer || t.playerIds.includes(playerId) || t.explainerId === playerId) continue;
    if (interests[t.gameId] !== 'yes') continue;
    const game = games.find((g) => g.id === t.gameId);
    if (!game || t.playerIds.length >= game.maxPlayers) continue;
    if (mine.some((m) => m.gameId === t.gameId) && !repeatGameIds.includes(t.gameId)) continue;
    if (toMinutes(t.startTime) < from || toMinutes(t.endTime) > to) continue;
    const clashes = mine
      .filter((m) => overlaps(toTimeString(toMinutes(m.startTime) - bufferMinutes), toTimeString(toMinutes(m.endTime) + bufferMinutes), t.startTime, t.endTime))
      .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
    if (clashes.length > 0) out.push({ table: t, clashes, rejected: (t.rejectedIds ?? []).includes(playerId) });
  }
  return out.sort((a, b) => toMinutes(a.table.startTime) - toMinutes(b.table.startTime));
}
