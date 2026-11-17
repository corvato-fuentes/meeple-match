import type { Game } from './types';
import { normalizeGameName } from './gameMatch';
import { estimatedDuration } from './tableAlgorithm';
import { roundUp5 } from './timeUtils';

/**
 * A table that starts in the room without having been planned in the app ("mesa improvisada"): people grab a game and play. The
 * organizers write it down so "sin mesa", "lugares libres" and the game's copies tell the truth. What helps them do it fast lives here.
 */

/** The name the owner of a game created on the spot carries (it has no real owner). */
export const IMPROVISED_OWNER = 'Mesa improvisada';

/** The game whose name is exactly this text (ignoring case, accents and punctuation), if there is one. Library games win. */
export function findGameByText(text: string, games: Game[]): Game | null {
  const key = normalizeGameName(text);
  if (!key) return null;
  const same = games.filter((g) => normalizeGameName(g.name) === key);
  return same.find((g) => !g.adHoc) ?? same[0] ?? null;
}

/** Games to suggest for what has been typed: the ones whose name contains it, the library's first and then the earlier improvised ones. */
export function suggestGames(text: string, games: Game[], limit = 6): Game[] {
  const key = normalizeGameName(text);
  if (!key) return [];
  const hits = games.filter((g) => !g.deleted && normalizeGameName(g.name).includes(key));
  // Several copies of a game are listed once, by their primary
  const primary = hits.filter((g) => !g.groupId || g.groupId === g.id);
  return (primary.length > 0 ? primary : hits)
    .sort((a, b) => Number(!!a.adHoc) - Number(!!b.adHoc) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** The durations offered for how long the table will play (minutes). */
export const DURATION_CHOICES = [45, 60, 90, 120, 180] as const;

/** The times a game made on the spot is loaded with, like any game (minutes). */
export interface NewGameTimes { setupMinutes: number; explanationMinutes: number; perPlayerMinutes: number }

/** What a new game's times start with, for the organizers to change. */
export const DEFAULT_NEW_GAME_TIMES: NewGameTimes = { setupMinutes: 5, explanationMinutes: 10, perPlayerMinutes: 15 };

/**
 * How long a table of this game takes with this many people: the game's own numbers (setup + explanation + minutes per player, or its
 * flat duration), the way every table is sized. 90 when there is no game yet. Always a multiple of 5.
 */
export function proposedMinutes(game: Game | null, people: number): number {
  if (!game) return 90;
  return estimatedDuration(game, Math.max(2, people));
}

/** The same for a game that is not loaded yet, from the times being typed. */
export function newGameMinutes(times: NewGameTimes, people: number): number {
  return roundUp5(times.setupMinutes + times.explanationMinutes + times.perPlayerMinutes * Math.max(2, people));
}
