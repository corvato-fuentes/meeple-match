import { describe, expect, it } from 'vitest';
import { findDeletedTwin, normalizeGameName } from './gameMatch';

type G = { name: string; bggUrl: string | null; deleted?: boolean };
const g = (name: string, bggUrl: string | null = null, deleted = true): G => ({ name, bggUrl, deleted });

describe('normalizeGameName', () => {
  it('ignores case, accents and punctuation', () => {
    expect(normalizeGameName('Dune: Imperium – Uprising')).toBe('dune imperium uprising');
    expect(normalizeGameName('  ¡Aventureros al Tren! Europa ')).toBe('aventureros al tren europa');
    expect(normalizeGameName('Castillos de Borgoña')).toBe('castillos de borgona');
  });
});

describe('findDeletedTwin', () => {
  it('finds the deleted game with the same BoardGameGeek link, however the link is written', () => {
    const games = [g('Dune uprising', 'https://boardgamegeek.com/boardgame/397598')];
    expect(findDeletedTwin(games, { name: 'Otro nombre', bggUrl: 'http://www.boardgamegeek.com/boardgame/397598/' })).toBe(games[0]);
    expect(findDeletedTwin(games, { name: 'x', bggUrl: 'https://boardgamegeek.com/boardgame/397598?foo=1' })).toBe(games[0]);
  });
  it('without a link, matches on the name', () => {
    const games = [g('Castillos de Borgoña')];
    expect(findDeletedTwin(games, { name: 'castillos de borgona', bggUrl: null })).toBe(games[0]);
  });
  it('a different game with a similar name is not the same game', () => {
    const games = [g('Dune: Imperium', 'https://boardgamegeek.com/boardgame/316554')];
    expect(findDeletedTwin(games, { name: 'Dune: Imperium – Uprising', bggUrl: 'https://boardgamegeek.com/boardgame/397598' })).toBeNull();
  });
  it('only games that were deleted count: a live one is not taken over', () => {
    expect(findDeletedTwin([g('Container', null, false)], { name: 'Container', bggUrl: null })).toBeNull();
    expect(findDeletedTwin([], { name: 'Container', bggUrl: null })).toBeNull();
  });
  it('prefers the link over the name', () => {
    const byName = g('Brass', 'https://boardgamegeek.com/boardgame/1');
    const byLink = g('Brass Birmingham', 'https://boardgamegeek.com/boardgame/224517');
    expect(findDeletedTwin([byName, byLink], { name: 'Brass', bggUrl: 'https://boardgamegeek.com/boardgame/224517' })).toBe(byLink);
  });
  it('a nameless game matches nothing', () => {
    expect(findDeletedTwin([g('')], { name: '', bggUrl: null })).toBeNull();
  });
});
