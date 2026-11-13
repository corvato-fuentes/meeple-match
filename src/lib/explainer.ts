import type { Player } from './types';

/**
 * Who takes over explaining a table when its explainer is no longer in it: the first of the people still there who marked that
 * they can explain the game, in the order given. Null when none of them can — nobody is made the explainer just for being
 * first in the list, since that puts someone who never said they know the game in charge of teaching it. The table then has
 * nobody to run it and is undone.
 * `gameIds` are the ids the game may be known under (a merged game's old and new one).
 */
export function nextExplainer(
  gameIds: string[],
  remainingIds: string[],
  playerById: (id: string) => Pick<Player, 'canExplain'> | undefined,
): string | null {
  return remainingIds.find((id) => (playerById(id)?.canExplain ?? []).some((g) => gameIds.includes(g))) ?? null;
}
