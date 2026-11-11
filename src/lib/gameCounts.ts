import type { Game } from './types';

/**
 * How many games are registered: `games` counts each game once (copies the admin merged into one count as one, like the
 * lists show them), `copies` counts every entry people registered. Games removed with votes pending (`deleted`) are left out.
 */
export function countGames(games: Game[]): { games: number; copies: number } {
  const live = games.filter((g) => !g.deleted);
  return { games: live.filter((g) => !g.groupId || g.groupId === g.id).length, copies: live.length };
}
