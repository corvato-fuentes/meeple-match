/** BGG's community poll for one player count: how many people voted it Best / Recommended / Not Recommended. */
export interface PollRow {
  players: number;
  best: number;
  recommended: number;
  notRecommended: number;
}

/**
 * The player count range to suggest from BGG's community poll. A count is usable when it has votes and "Not
 * Recommended" isn't its plurality; one-player counts never are (this app seats people at shared tables). Of those, the
 * range is the unbroken run around the count with the most "Best" votes — it stops at the first count that isn't
 * usable, so an isolated count after a gap (a 6-player mode or an expansion, when 5 players is recommended against)
 * isn't dragged in. Null when the poll has nothing usable, so the caller falls back to the box numbers.
 */
export function pickPlayerRange(rows: PollRow[]): { min: number; max: number } | null {
  const usable = rows.filter((r) =>
    r.players >= 2 && r.best + r.recommended + r.notRecommended > 0 && !(r.notRecommended > r.best && r.notRecommended > r.recommended));
  if (usable.length === 0) return null;
  const ok = new Set(usable.map((r) => r.players));
  // The count most people say is the best one (the smaller one if two tie)
  const peak = usable.reduce((top, r) => (r.best > top.best || (r.best === top.best && r.players < top.players) ? r : top)).players;
  let min = peak;
  let max = peak;
  while (ok.has(min - 1)) min--;
  while (ok.has(max + 1)) max++;
  return { min, max };
}
