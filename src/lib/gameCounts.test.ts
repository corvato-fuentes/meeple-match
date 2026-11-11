import { describe, expect, it } from 'vitest';
import { countGames } from './gameCounts';
import type { Game } from './types';

const g = (id: string, o: Partial<Game> = {}) => ({ id, name: id, ...o }) as Game;

describe('countGames', () => {
  it('counts every game once and tells how many copies are registered', () => {
    expect(countGames([g('a'), g('b'), g('c', { groupId: 'b' })])).toEqual({ games: 2, copies: 3 });
  });
  it('a primary that points at itself is still one game; removed games are left out; no games is zero', () => {
    expect(countGames([g('a', { groupId: 'a' }), g('b', { deleted: true })])).toEqual({ games: 1, copies: 1 });
    expect(countGames([])).toEqual({ games: 0, copies: 0 });
  });
});
