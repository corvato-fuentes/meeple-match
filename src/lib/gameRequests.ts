// "Juegos pedidos": games people would like someone to bring to the event. Shared by the API routes and the screens.

/** What one request looks like to the person looking at it (names already resolved, "me" told apart). */
export interface GameRequestView {
  id: string;
  /** BoardGameGeek id, or null for a game typed in by hand. */
  bggId: string | null;
  name: string;
  year: string | null;
  imageUrl: string | null;
  bggUrl: string | null;
  /** Display names of everyone who asked for it, except the person looking. */
  others: string[];
  iRequested: boolean;
  /** Who promised to bring it (null = nobody yet). */
  claimedBy: string | null;
  iClaimed: boolean;
  createdAt: number;
}

const fold = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** The id a request is stored under: one per BGG game, or one per (accent-free) name for a game typed by hand. */
export function requestIdFor(bggId: string | null, name: string): string {
  if (bggId) return `bgg-${bggId}`;
  return `name-${fold(name).replace(/ /g, '-').slice(0, 60) || 'juego'}`;
}

export const isValidRequestId = (id: unknown): id is string => typeof id === 'string' && /^(bgg-\d{1,8}|name-[a-z0-9-]{1,60})$/.test(id);

/**
 * "A David le gustaría que alguien lo lleve" — who asked for the game, in plain words. `others` are the names of the
 * other people who asked; `includesMe` says whether the reader is one of them (then it reads "vos").
 */
export function describeRequesters(others: string[], includesMe: boolean): string {
  if (includesMe && others.length === 0) return 'Pediste que alguien lo lleve';
  const names = includesMe ? ['vos', ...others] : others;
  if (names.length === 0) return 'Alguien pidió que lo lleven';
  const verb = 'le gustaría que alguien lo lleve';
  if (names.length === 1) return `A ${names[0]} ${verb}`;
  if (names.length === 2) return `A ${names[0]} y a ${names[1]} les gustaría que alguien lo lleve`;
  return `A ${names[0]}, ${names[1]} y ${names.length - 2} más les gustaría que alguien lo lleve`;
}

/** Does a game someone already brings correspond to this request? By BGG link when there is one, otherwise by name. */
export function requestMatchesGame(request: { bggId: string | null; name: string }, game: { name: string; bggUrl?: string | null }): boolean {
  if (request.bggId && game.bggUrl && new RegExp(`/boardgame/${request.bggId}(?:[/?#]|$)`).test(game.bggUrl)) return true;
  return fold(request.name) !== '' && fold(request.name) === fold(game.name);
}
