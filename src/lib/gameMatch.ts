import type { Game } from './types';

/** "Dune: Imperium – Uprising" and "dune imperium uprising" are the same game: lower case, no accents, no punctuation. */
export function normalizeGameName(name: string): string {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** A BoardGameGeek link without the parts that don't change which game it is (the www, a trailing slash, the query). */
function normalizeBggUrl(url: string): string {
  return url.trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
}

/**
 * The game that was deleted — and kept because it had votes — that a game being added is the same as: the same BoardGameGeek
 * link, or, when the new one has none, the same name. The new game then takes that one's place, so the votes people already
 * gave it (kept under its id) count again without anyone having to move them.
 */
export function findDeletedTwin<T extends Pick<Game, 'name' | 'bggUrl' | 'deleted'>>(
  games: T[], added: Pick<Game, 'name' | 'bggUrl'>
): T | null {
  const deleted = games.filter((g) => g.deleted);
  if (added.bggUrl) {
    const url = normalizeBggUrl(added.bggUrl);
    const byLink = deleted.find((g) => g.bggUrl && normalizeBggUrl(g.bggUrl) === url);
    if (byLink) return byLink;
  }
  const name = normalizeGameName(added.name);
  if (!name) return null;
  return deleted.find((g) => normalizeGameName(g.name) === name) ?? null;
}
