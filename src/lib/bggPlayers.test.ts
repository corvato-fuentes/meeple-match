import { describe, expect, it } from 'vitest';
import { pickPlayerRange, type PollRow } from './bggPlayers';

const row = (players: number, best: number, recommended: number, notRecommended: number): PollRow => ({ players, best, recommended, notRecommended });

describe('pickPlayerRange', () => {
  it('Dune: Imperium Uprising: stops before the lone 6-player mode that comes after a count voted against (2–4, not 2–6)', () => {
    expect(pickPlayerRange([row(1, 24, 178, 127), row(2, 21, 200, 135), row(3, 182, 233, 21), row(4, 367, 97, 8), row(5, 2, 15, 271), row(6, 66, 155, 61)]))
      .toEqual({ min: 2, max: 4 });
  });
  it('Dune: Imperium: the whole usable run', () => {
    expect(pickPlayerRange([row(2, 72, 786, 409), row(3, 942, 449, 29), row(4, 938, 380, 61)])).toEqual({ min: 2, max: 4 });
  });
  it('grows from the best count in both directions while counts stay usable', () => {
    expect(pickPlayerRange([row(2, 5, 30, 4), row(3, 20, 40, 3), row(4, 90, 30, 2), row(5, 40, 50, 6), row(6, 10, 20, 4)])).toEqual({ min: 2, max: 6 });
  });
  it('a usable count on the far side of a gap, before the best one, is left out too', () => {
    expect(pickPlayerRange([row(2, 30, 20, 1), row(3, 1, 2, 90), row(4, 80, 20, 2), row(5, 40, 40, 5)])).toEqual({ min: 4, max: 5 });
  });
  it('never suggests a solo game, ignores counts with no votes, and returns null when nothing is usable', () => {
    expect(pickPlayerRange([row(1, 100, 10, 1), row(2, 5, 3, 1)])).toEqual({ min: 2, max: 2 });
    expect(pickPlayerRange([row(2, 0, 0, 0), row(3, 0, 0, 0)])).toBeNull();
    expect(pickPlayerRange([row(2, 1, 1, 50)])).toBeNull();
    expect(pickPlayerRange([])).toBeNull();
  });
  it('on a tie for best, takes the smaller count', () => {
    expect(pickPlayerRange([row(2, 10, 5, 1), row(3, 10, 5, 1), row(5, 10, 5, 1)])).toEqual({ min: 2, max: 3 });
  });
});
