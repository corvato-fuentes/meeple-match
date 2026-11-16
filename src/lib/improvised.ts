import type { Game } from './types';
import { normalizeGameName } from './gameMatch';

/**
 * A table that starts in the room without having been planned in the app ("mesa improvisada"): people grab a game and play. The
 * organizers write it down so "sin mesa", "lugares libres" and the game's copies tell the truth. What helps them do it fast lives here.
 */

/** Seats of a game created on the spot: the people sitting now, but never fewer than this. */
export const MIN_SEATS_NEW_GAME = 2;
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

/** The closest offered duration to what a game usually takes (90 when it isn't known). */
export function defaultDuration(game: Pick<Game, 'durationMinutes'> | null): number {
  const d = game?.durationMinutes;
  if (!d || d <= 0) return 90;
  return DURATION_CHOICES.reduce((best, c) => (Math.abs(c - d) < Math.abs(best - d) ? c : best), DURATION_CHOICES[0]);
}
