import { describe, expect, it } from 'vitest';
import { timeAgo } from './timeAgo';

const NOW = 1_700_000_000_000;
const ago = (ms: number) => timeAgo(NOW - ms, NOW);
const MIN = 60_000;

describe('timeAgo', () => {
  it('says "hace un momento" for the last few seconds', () => {
    expect(ago(0)).toBe('hace un momento');
    expect(ago(20_000)).toBe('hace un momento');
  });
  it('counts minutes, then hours, then days', () => {
    expect(ago(5 * MIN)).toBe('hace 5 min');
    expect(ago(59 * MIN)).toBe('hace 59 min');
    expect(ago(60 * MIN)).toBe('hace 1 h');
    expect(ago(150 * MIN)).toBe('hace 3 h');
    expect(ago(24 * 60 * MIN)).toBe('hace 1 día');
    expect(ago(3 * 24 * 60 * MIN)).toBe('hace 3 días');
  });
  it('never goes negative for a timestamp slightly in the future (clock skew)', () => {
    expect(ago(-5 * MIN)).toBe('hace un momento');
  });
});
