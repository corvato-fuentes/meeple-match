import { describe, expect, it } from 'vitest';
import { hasOfferFor, isOfferFor, isPostedOfferFor, otherOffersForGame } from './offers';
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

describe('isPostedOfferFor / hasOfferFor — tables owners posted', () => {
  const posted = (o: Partial<Table> = {}) => table({ postedByOwner: true, ...o });

  it('a posted table is an offer to the interested people it was offered to, until they answer', () => {
    expect(isPostedOfferFor(posted(), 'p1')).toBe(true);
    expect(isPostedOfferFor(posted(), 'p2')).toBe(false);
    expect(isPostedOfferFor(posted({ playerIds: ['p1'] }), 'p1')).toBe(false);
    expect(isPostedOfferFor(posted({ rejectedIds: ['p1'] }), 'p1')).toBe(false);
    expect(isPostedOfferFor(posted({ playerIds: ['a', 'b'] }), 'p1', { maxPlayers: 2 })).toBe(false);
  });
  it('is kept apart from the algorithm\'s own offers, and hasOfferFor covers both', () => {
    expect(isOfferFor(posted(), 'p1')).toBe(false);
    expect(isPostedOfferFor(table(), 'p1')).toBe(false);
    expect(hasOfferFor(posted(), 'p1') && hasOfferFor(table(), 'p1')).toBe(true);
  });
});

describe('otherOffersForGame', () => {
  const gameOf = () => ({ maxPlayers: 4 });
  const tables = [
    table({ id: 'a', gameId: 'g', startTime: '16:00', endTime: '17:00' }),
    table({ id: 'b', gameId: 'g', postedByOwner: true, startTime: '12:00', endTime: '13:00' }),
    table({ id: 'c', gameId: 'other', startTime: '11:00', endTime: '12:00' }),
    table({ id: 'd', gameId: 'g', startTime: '09:00', endTime: '10:00', candidateIds: [] }),
  ];
  it('lists the other tables of that game still waiting for the player, in time order, without the one just accepted', () => {
    expect(otherOffersForGame(tables, 'p1', 'g', 'x', gameOf).map((t) => t.id)).toEqual(['b', 'a']);
    expect(otherOffersForGame(tables, 'p1', 'g', 'b', gameOf).map((t) => t.id)).toEqual(['a']);
  });
  it('is empty when there is nothing else to answer', () => {
    expect(otherOffersForGame(tables, 'p9', 'g', 'a', gameOf)).toEqual([]);
  });
});
