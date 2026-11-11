import { describe, expect, it } from 'vitest';
import { isOfferFor } from './offers';
import type { Table } from './types';

const table = (o: Partial<Table> = {}): Table =>
  ({ id: 't', gameId: 'g', gameName: 'g', startTime: '10:00', endTime: '11:00', explainerId: 'x', playerIds: [], status: 'recommended', candidateIds: ['p1'], rejectedIds: [], ...o }) as Table;

describe('isOfferFor', () => {
  it('is an offer on a recommended table the player is a candidate of', () => {
    expect(isOfferFor(table(), 'p1')).toBe(true);
    expect(isOfferFor(table(), 'p2')).toBe(false);
  });

  it('is also an offer on a CONFIRMED table with free places — a late voter is asked, not seated', () => {
    expect(isOfferFor(table({ status: 'confirmed', playerIds: ['a', 'b'] }), 'p1', { maxPlayers: 4 })).toBe(true);
  });

  it('is not an offer once the table has no place left, or once it is underway or finished', () => {
    expect(isOfferFor(table({ status: 'confirmed', playerIds: ['a', 'b'] }), 'p1', { maxPlayers: 2 })).toBe(false);
    expect(isOfferFor(table({ status: 'in-progress' }), 'p1')).toBe(false);
    expect(isOfferFor(table({ status: 'cancelled' }), 'p1')).toBe(false);
  });

  it('is not an offer to someone already seated, or who rejected the table, or on a posted table', () => {
    expect(isOfferFor(table({ playerIds: ['p1'] }), 'p1')).toBe(false);
    expect(isOfferFor(table({ rejectedIds: ['p1'] }), 'p1')).toBe(false);
    expect(isOfferFor(table({ postedByOwner: true }), 'p1')).toBe(false);
  });
});
