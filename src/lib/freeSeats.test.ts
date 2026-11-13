import { describe, expect, it } from 'vitest';
import { freeSeatsOf, hasOpenSeat, seatChanceFor } from './freeSeats';
import type { Game, Player, Table } from './types';

const game = { id: 'g1', name: 'Brass', maxPlayers: 4 } as Game;
const table = (over: Partial<Table> = {}): Table => ({
  id: 't1', tableNumber: 1, gameId: 'g1', gameName: 'Brass', startTime: '10:15', endTime: '13:15', explainerId: 'e',
  playerIds: ['e', 'a', 'b'], status: 'confirmed', isManuallyEdited: false, batchNumber: 1, ...over,
});
const viewer = (over: Partial<Player> = {}): Player => ({
  id: 'v', arrivalTime: '10:00', departureTime: '20:00', repeatGameIds: [], ...over,
} as Player);

describe('free places', () => {
  it('counts the places left, never below zero', () => {
    expect(freeSeatsOf(table(), game)).toBe(1);
    expect(freeSeatsOf(table({ playerIds: ['a', 'b', 'c', 'd', 'e'] }), game)).toBe(0);
    expect(freeSeatsOf(table(), undefined)).toBe(0);
  });
  it('only a confirmed table that has not started, with a place left, is open', () => {
    expect(hasOpenSeat(table(), game, false)).toBe(true);
    expect(hasOpenSeat(table(), game, true)).toBe(false);
    expect(hasOpenSeat(table({ status: 'recommended' }), game, false)).toBe(false);
    expect(hasOpenSeat(table({ playerIds: ['a', 'b', 'c', 'd'] }), game, false)).toBe(false);
  });
});

describe('seatChanceFor', () => {
  const base = { game, started: false };
  it('lets someone free at that hour take it', () => {
    expect(seatChanceFor({ ...base, viewer: viewer(), table: table(), tables: [table()] })).toBe('join');
  });
  it('an offer the system already made is answered as an offer', () => {
    const t = table({ candidateIds: ['v'] });
    expect(seatChanceFor({ ...base, viewer: viewer(), table: t, tables: [t] })).toBe('offered');
  });
  it('is nothing for the ones it is not for', () => {
    const t = table();
    expect(seatChanceFor({ ...base, viewer: null, table: t, tables: [t] })).toBeNull();
    expect(seatChanceFor({ ...base, viewer: viewer({ id: 'a' }), table: t, tables: [t] })).toBeNull(); // already in it
    expect(seatChanceFor({ ...base, viewer: viewer(), table: table({ rejectedIds: ['v'] }), tables: [t] })).toBeNull(); // declined it
    expect(seatChanceFor({ ...base, viewer: viewer({ registrationStatus: 'tentative' }), table: t, tables: [t] })).toBeNull(); // indeciso
    expect(seatChanceFor({ ...base, viewer: viewer({ arrivalTime: '11:00' }), table: t, tables: [t] })).toBeNull(); // arrives after it starts
    expect(seatChanceFor({ ...base, viewer: viewer({ departureTime: '13:00' }), table: t, tables: [t] })).toBeNull(); // leaves before it ends
    expect(seatChanceFor({ ...base, viewer: viewer(), table: t, tables: [t], started: true })).toBeNull();
  });
  it('already seated at another table of the game: only if they said they would play a second one', () => {
    const t = table();
    const other = table({ id: 't2', startTime: '15:00', endTime: '18:00', playerIds: ['v', 'x'] });
    expect(seatChanceFor({ ...base, viewer: viewer(), table: t, tables: [t, other] })).toBeNull();
    expect(seatChanceFor({ ...base, viewer: viewer({ repeatGameIds: ['g1'] }), table: t, tables: [t, other] })).toBe('join');
  });
  it('a clash with another table of theirs does not hide it (taking it asks what to do with the other one)', () => {
    const t = table();
    const clash = table({ id: 't3', gameId: 'g2', gameName: 'Dune', startTime: '12:00', endTime: '15:00', playerIds: ['v'] });
    expect(seatChanceFor({ ...base, viewer: viewer(), table: t, tables: [t, clash] })).toBe('join');
  });
});
