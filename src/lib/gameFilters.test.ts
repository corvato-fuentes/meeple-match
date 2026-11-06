import { describe, expect, it } from 'vitest';
import { activeFilterCount, filterGames, hasAnyFilter, NO_FILTERS, type GameFilters } from './gameFilters';
import type { Game } from './types';

const game = (name: string, o: Partial<Game> = {}): Game =>
  ({ id: name, name, minPlayers: 2, maxPlayers: 4, durationMinutes: 60, complexity: 'medium', ownerName: 'Ana', ...o }) as Game;

const games = [
  game('Catan', { minPlayers: 3, maxPlayers: 4, durationMinutes: 90, complexity: 'medium', ownerName: 'Beto' }),
  game('Dixit', { minPlayers: 3, maxPlayers: 6, durationMinutes: 30, complexity: 'light', ownerName: 'Cris' }),
  game('Terraforming Mars', { minPlayers: 1, maxPlayers: 5, durationMinutes: 120, complexity: 'heavy', ownerName: 'Ana' }),
  game('Gloomhaven: Mandíbulas del León', { minPlayers: 1, maxPlayers: 4, durationMinutes: 151, complexity: 'heavy', ownerName: 'Dani' }),
  game('Codenames', { minPlayers: 4, maxPlayers: 8, durationMinutes: 15, complexity: 'light', ownerName: 'Ana' }),
  game('Azul', { minPlayers: 2, maxPlayers: 4, durationMinutes: 38, complexity: 'light', ownerName: 'Eli' }),
];
const names = (f: Partial<GameFilters>) => filterGames(games, { ...NO_FILTERS, ...f }).map((g) => g.name);

describe('filterGames — search', () => {
  it('keeps everything, in order, when there are no filters', () => {
    expect(names({})).toEqual(games.map((g) => g.name));
  });
  it('matches by name, ignoring case and accents either way', () => {
    expect(names({ query: 'cat' })).toEqual(['Catan']);
    expect(names({ query: 'MANDIBULAS' })).toEqual(['Gloomhaven: Mandíbulas del León']);
    expect(names({ query: 'león' })).toEqual(['Gloomhaven: Mandíbulas del León']);
  });
  it('matches by who brings the game', () => {
    expect(names({ query: 'beto' })).toEqual(['Catan']);
  });
  it('needs every word, in any order', () => {
    expect(names({ query: 'mars terraforming' })).toEqual(['Terraforming Mars']);
    expect(names({ query: 'catan dixit' })).toEqual([]);
  });
  it('treats a blank search as no search', () => {
    expect(names({ query: '   ' })).toHaveLength(games.length);
  });
  it('does not break on a game without an owner name', () => {
    expect(filterGames([{ ...game('Sin dueño'), ownerName: undefined } as unknown as Game], { ...NO_FILTERS, query: 'sin' })).toHaveLength(1);
  });
});

describe('filterGames — filters', () => {
  it('by difficulty (one or several)', () => {
    expect(names({ complexity: ['light'] })).toEqual(['Dixit', 'Codenames', 'Azul']);
    expect(names({ complexity: ['light', 'heavy'] })).toHaveLength(5);
  });
  it('by duration, using the rounded-up time the app shows (38 → 40)', () => {
    expect(names({ duration: 'le30' })).toEqual(['Dixit', 'Codenames']);
    expect(names({ duration: 'le60' })).toEqual(['Dixit', 'Codenames', 'Azul']);
    expect(names({ duration: 'le120' })).toContain('Terraforming Mars'); // exactly 120 counts
    expect(names({ duration: 'gt120' })).toEqual(['Gloomhaven: Mandíbulas del León']);
  });
  it('by how many people play, inclusive at both ends', () => {
    expect(names({ players: 1 })).toEqual(['Terraforming Mars', 'Gloomhaven: Mandíbulas del León']);
    expect(names({ players: 7 })).toEqual(['Codenames']);
    expect(names({ players: 4 })).toHaveLength(6);
  });
  it('combines them all', () => {
    expect(names({ complexity: ['light'], duration: 'le30', players: 4 })).toEqual(['Dixit', 'Codenames']);
    expect(names({ query: 'a', complexity: ['heavy'] })).toEqual(['Terraforming Mars', 'Gloomhaven: Mandíbulas del León']);
    expect(names({ query: 'zzz' })).toEqual([]);
  });
});

describe('filter bookkeeping', () => {
  it('counts active filter groups but not the search box', () => {
    expect(activeFilterCount({ ...NO_FILTERS, query: 'x' })).toBe(0);
    expect(activeFilterCount({ query: '', complexity: ['light', 'heavy'], duration: 'le60', players: 3 })).toBe(3);
  });
  it('knows whether anything is active', () => {
    expect(hasAnyFilter(NO_FILTERS)).toBe(false);
    expect(hasAnyFilter({ ...NO_FILTERS, query: 'x' })).toBe(true);
    expect(hasAnyFilter({ ...NO_FILTERS, players: 2 })).toBe(true);
  });
});
