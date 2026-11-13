import { describe, expect, it } from 'vitest';
import { nextExplainer } from './explainer';

const players: Record<string, { canExplain: string[] }> = {
  a: { canExplain: [] },            // the first in the list, never said they know it
  b: { canExplain: ['brass'] },
  c: { canExplain: ['brass', 'dune'] },
  d: { canExplain: ['dune'] },
};
const byId = (id: string) => players[id];

describe('nextExplainer', () => {
  it('takes the first of the people left who can explain the game, not simply the first in the list', () => {
    expect(nextExplainer(['brass'], ['a', 'b', 'c'], byId)).toBe('b');
    expect(nextExplainer(['dune'], ['a', 'b', 'c', 'd'], byId)).toBe('c');
  });
  it('is null when none of them can: nobody is put in charge of teaching it by default', () => {
    expect(nextExplainer(['brass'], ['a', 'd'], byId)).toBeNull();
    expect(nextExplainer(['brass'], [], byId)).toBeNull();
    expect(nextExplainer(['brass'], ['unknown'], byId)).toBeNull();
  });
  it('knows a game under either of its ids', () => {
    expect(nextExplainer(['old-brass', 'brass'], ['a', 'b'], byId)).toBe('b');
  });
});
