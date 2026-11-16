import { describe, expect, it } from 'vitest';
import { isQuietConflict, splitConflicts } from './scheduleConflicts';

const t = (status: string) => ({ status }) as never;

describe('a conflict that is only a table still waiting for players', () => {
  it('is quiet when it is not confirmed', () => {
    expect(isQuietConflict(t('recommended'))).toBe(true);
  });
  it('is not quiet once the table is set, or underway', () => {
    expect(isQuietConflict(t('confirmed'))).toBe(false);
    expect(isQuietConflict(t('in-progress'))).toBe(false);
  });
  it('splits a mix: the confirmed one still asks, the waiting one is just left', () => {
    const waiting = t('recommended');
    const confirmed = t('confirmed');
    expect(splitConflicts([waiting, confirmed])).toEqual({ loud: [confirmed], quiet: [waiting] });
  });
});
