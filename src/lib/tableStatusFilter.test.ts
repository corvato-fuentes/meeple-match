import { describe, expect, it } from 'vitest';
import { STATUS_FILTERS, everSet, matchesStatusFilter } from './tableStatusFilter';

const t = (status: string, postedByOwner?: boolean) => ({ status, postedByOwner }) as never;

describe('everSet (which cancelled tables the admin sees)', () => {
  it('is a table that was confirmed and then fell through', () => {
    expect(everSet({ everConfirmed: true })).toBe(true);
  });
  it('is not one that only ever waited, nor one from before the mark existed', () => {
    expect(everSet({})).toBe(false);
    expect(everSet({ everConfirmed: false })).toBe(false);
  });
});

describe('matchesStatusFilter', () => {
  it('"Todas" holds everything', () => {
    for (const s of ['recommended', 'confirmed', 'in-progress', 'completed', 'cancelled']) expect(matchesStatusFilter(t(s), 'all')).toBe(true);
  });

  it('tells a table the algorithm proposed from one its owner posted, both waiting for players', () => {
    expect(matchesStatusFilter(t('recommended'), 'recommended')).toBe(true);
    expect(matchesStatusFilter(t('recommended', true), 'recommended')).toBe(false);
    expect(matchesStatusFilter(t('recommended', true), 'posted')).toBe(true);
    expect(matchesStatusFilter(t('recommended'), 'posted')).toBe(false);
  });

  it('the other states match their own', () => {
    expect(matchesStatusFilter(t('confirmed', true), 'confirmed')).toBe(true);
    expect(matchesStatusFilter(t('confirmed'), 'posted')).toBe(false);
    expect(matchesStatusFilter(t('in-progress'), 'in-progress')).toBe(true);
    expect(matchesStatusFilter(t('completed'), 'completed')).toBe(true);
    expect(matchesStatusFilter(t('cancelled'), 'cancelled')).toBe(true);
    expect(matchesStatusFilter(t('cancelled'), 'confirmed')).toBe(false);
  });

  it('each table is under exactly one state chip', () => {
    const states = STATUS_FILTERS.filter((f) => f.key !== 'all');
    for (const x of [t('recommended'), t('recommended', true), t('confirmed'), t('in-progress'), t('completed'), t('cancelled')]) {
      expect(states.filter((f) => matchesStatusFilter(x, f.key))).toHaveLength(1);
    }
  });
});
