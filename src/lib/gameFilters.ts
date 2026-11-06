import type { Game, GameComplexity } from './types';
import { roundUp5 } from './timeUtils';

// Search + filters for the list of games people vote on (the event can have 70+ of them).

export type DurationRange = 'any' | 'le30' | 'le60' | 'le120' | 'gt120';

export interface GameFilters {
  /** Free text, matched against the game's name and the name of whoever brings it (accents and case ignored). */
  query: string;
  /** Empty = any difficulty. */
  complexity: GameComplexity[];
  duration: DurationRange;
  /** How many people will play: keeps the games whose min–max range includes that number. null = any. */
  players: number | null;
}

export const NO_FILTERS: GameFilters = { query: '', complexity: [], duration: 'any', players: null };

export const DURATION_LABEL: Record<DurationRange, string> = {
  any: 'Cualquier duración',
  le30: 'Hasta 30 min',
  le60: 'Hasta 1 hora',
  le120: 'Hasta 2 horas',
  gt120: 'Más de 2 horas',
};

const fold = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

function inDuration(minutes: number, range: DurationRange): boolean {
  const m = roundUp5(minutes); // the app always shows durations rounded up to 5
  switch (range) {
    case 'le30': return m <= 30;
    case 'le60': return m <= 60;
    case 'le120': return m <= 120;
    case 'gt120': return m > 120;
    default: return true;
  }
}

export function filterGames(games: Game[], f: GameFilters): Game[] {
  const words = fold(f.query).split(/\s+/).filter(Boolean);
  return games.filter((g) => {
    if (words.length > 0) {
      const haystack = fold(`${g.name} ${g.ownerName ?? ''}`);
      if (!words.every((w) => haystack.includes(w))) return false; // every word must appear, in any order
    }
    if (f.complexity.length > 0 && !f.complexity.includes(g.complexity)) return false;
    if (!inDuration(g.durationMinutes, f.duration)) return false;
    if (f.players != null && (f.players < g.minPlayers || f.players > g.maxPlayers)) return false;
    return true;
  });
}

/** How many filters are on (the search box not included): drives the badge on the "Filtros" button. */
export function activeFilterCount(f: GameFilters): number {
  return (f.complexity.length > 0 ? 1 : 0) + (f.duration !== 'any' ? 1 : 0) + (f.players != null ? 1 : 0);
}

export const hasAnyFilter = (f: GameFilters) => f.query.trim() !== '' || activeFilterCount(f) > 0;
