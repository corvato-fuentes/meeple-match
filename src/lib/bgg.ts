import type { GameComplexity } from './types';

// Fallback link to BGG's search page when a game has no direct bggUrl saved
export function bggSearchUrl(gameName: string): string {
  return `https://boardgamegeek.com/geeksearch.php?action=search&objecttype=boardgame&q=${encodeURIComponent(gameName)}`;
}

export interface BggSearchResult {
  id: string;
  name: string;
  year: string | null;
}

export interface BggGameDetails {
  bggUrl: string;
  minPlayers: number;
  maxPlayers: number;
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
