import type { GameComplexity } from './types';

// Fallback link to BGG's search page when a game has no direct bggUrl saved
export function bggSearchUrl(gameName: string): string {
  return `https://boardgamegeek.com/geeksearch.php?action=search&objecttype=boardgame&q=${encodeURIComponent(gameName)}`;
}

// The manual "Link BGG" field is free text with no format enforcement — guards against rendering
// a stray non-URL value (e.g. a game name typed into the wrong box) as a clickable link.
export function isBggUrl(url: string | null | undefined): url is string {
  return !!url && /^https?:\/\//.test(url);
}

export interface BggSearchResult {
  id: string;
  name: string;
  year: string | null;
  imageUrl: string | null;
}

export interface BggGameDetails {
  bggUrl: string;
  imageUrl: string | null;
  minPlayers: number;
  maxPlayers: number;
  // The box's actual max capacity — maxPlayers above may be narrower (BGG's community "best with"
  // range). Use this one for anything computed off the game's full player range, e.g. per-player time.
  boxMaxPlayers: number;
  durationMinutes: number;
  complexity: GameComplexity;
}

/** Searches BGG's real catalog via our own API route (browser fetch to BGG directly is blocked by CORS) */
export async function searchBgg(query: string): Promise<BggSearchResult[]> {
  const res = await fetch(`/api/bgg/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error('BGG search request failed');
  const data = await res.json();
  return data.results as BggSearchResult[];
}

/** Fetches player count / duration / weight for a specific BGG game and maps them to our schema */
export async function getBggGameDetails(id: string): Promise<BggGameDetails> {
  const res = await fetch(`/api/bgg/thing?id=${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error('BGG game details request failed');
  return res.json();
}
