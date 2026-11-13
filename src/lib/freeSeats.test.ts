import { describe, expect, it } from 'vitest';
import { blockedMessage, freeSeatsOf, hasOpenSeat, hasWaitingSeat, missingToConfirm, seatOptionFor } from './freeSeats';
import type { Game, Player, Table } from './types';

const game = { id: 'g1', name: 'Brass', minPlayers: 3, maxPlayers: 4 } as Game;
const table = (over: Partial<Table> = {}): Table => ({
  id: 't1', tableNumber: 1, gameId: 'g1', gameName: 'Brass', startTime: '10:15', endTime: '13:15', explainerId: 'e',
  playerIds: ['e', 'a', 'b'], status: 'confirmed', isManuallyEdited: false, batchNumber: 1, ...over,
});
const viewer = (over: Partial<Player> = {}): Player => ({
  id: 'v', arrivalTime: '10:00', departureTime: '20:00', repeatGameIds: [], interests: {}, ...over,
} as Player);
const base = { game, started: false };
const opt = (v: Player | null, t: Table, tables: Table[] = [t], started = false) => seatOptionFor({ ...base, started, viewer: v, table: t, tables });

describe('free places', () => {
  it('counts the places left, never below zero', () => {
    expect(freeSeatsOf(table(), game)).toBe(1);
    expect(freeSeatsOf(table({ playerIds: ['a', 'b', 'c', 'd', 'e'] }), game)).toBe(0);
    expect(freeSeatsOf(table(), undefined)).toBe(0);
  });
  it('a confirmed table is open while it has a place and has not started; a waiting one is too', () => {
    expect(hasOpenSeat(table(), game, false)).toBe(true);
    expect(hasOpenSeat(table(), game, true)).toBe(false);
    expect(hasOpenSeat(table({ status: 'recommended' }), game, false)).toBe(false);
    expect(hasOpenSeat(table({ playerIds: ['a', 'b', 'c', 'd'] }), game, false)).toBe(false);
    expect(hasWaitingSeat(table({ status: 'recommended' }), game, false)).toBe(true);
    expect(hasWaitingSeat(table({ status: 'recommended' }), game, true)).toBe(false);
    expect(hasWaitingSeat(table(), game, false)).toBe(false);
  });
  it('says how many a waiting table still needs to be confirmed', () => {
    expect(missingToConfirm(table({ playerIds: ['e'] }), game)).toBe(2);
    expect(missingToConfirm(table(), game)).toBe(0);
  });
});

describe('seatOptionFor on a confirmed table', () => {
  it('lets someone free at that hour take it', () => {
    expect(opt(viewer(), table())).toEqual({ kind: 'join' });
  });
  it('an offer the system already made is answered as an offer', () => {
    expect(opt(viewer(), table({ candidateIds: ['v'] }))).toEqual({ kind: 'offered' });
  });
  it('shows nothing when there is nobody looking, or the table is not open', () => {
    expect(opt(null, table())).toBeNull();
    expect(opt(viewer(), table(), [table()], true)).toBeNull();
    expect(opt(viewer(), table({ playerIds: ['a', 'b', 'c', 'd'] }))).toBeNull();
  });
  it('says why it is not for them', () => {
    expect(opt(viewer({ id: 'a' }), table())).toEqual({ kind: 'blocked', reason: { kind: 'in-table' } });
    expect(opt(viewer(), table({ rejectedIds: ['v'] }))).toEqual({ kind: 'blocked', reason: { kind: 'rejected' } });
    expect(opt(viewer({ registrationStatus: 'tentative' }), table())).toEqual({ kind: 'blocked', reason: { kind: 'tentative' } });
    expect(opt(viewer({ arrivalTime: '11:00' }), table())).toEqual({ kind: 'blocked', reason: { kind: 'outside-hours', arrival: '11:00', departure: '20:00' } });
    expect(opt(viewer({ departureTime: '13:00' }), table())).toEqual({ kind: 'blocked', reason: { kind: 'outside-hours', arrival: '10:00', departure: '13:00' } });
  });
  it('already seated at another table of the game: only if they said they would play a second one', () => {
    const t = table();
    const other = table({ id: 't2', startTime: '15:00', endTime: '18:00', playerIds: ['v', 'x'] });
    expect(opt(viewer(), t, [t, other])).toEqual({ kind: 'blocked', reason: { kind: 'has-game-table' } });
    expect(opt(viewer({ repeatGameIds: ['g1'] }), t, [t, other])).toEqual({ kind: 'join' });
  });
  it('a clash with another table of theirs does not block it (taking it asks what to do with the other one)', () => {
    const t = table();
    const clash = table({ id: 't3', gameId: 'g2', gameName: 'Dune', startTime: '12:00', endTime: '15:00', playerIds: ['v'] });
    expect(opt(viewer(), t, [t, clash])).toEqual({ kind: 'join' });
  });
});

describe('seatOptionFor on a table that is still waiting for players', () => {
  const waiting = (over: Partial<Table> = {}) => table({ status: 'recommended', playerIds: ['e'], ...over });
  it('a table somebody posted is joined directly', () => {
    expect(opt(viewer(), waiting({ postedByOwner: true }))).toEqual({ kind: 'join' });
  });
  it('one the algorithm built is offered when it fits; otherwise voting is how it gets offered', () => {
    expect(opt(viewer(), waiting({ candidateIds: ['v'] }))).toEqual({ kind: 'offered' });
    expect(opt(viewer(), waiting())).toEqual({ kind: 'vote' });
  });
  it('someone who already voted the game is told it will be offered when it fits', () => {
    expect(opt(viewer({ interests: { g1: 'yes' } }), waiting())).toEqual({ kind: 'blocked', reason: { kind: 'voted' } });
  });
  it('queued behind its explainer: nothing to do yet', () => {
    expect(opt(viewer(), waiting({ awaitingExplainer: true, queuedIds: ['v'] }))).toEqual({ kind: 'blocked', reason: { kind: 'queued' } });
  });
});

describe('blockedMessage', () => {
  it('names the hours when it is the hours', () => {
    const msg = blockedMessage({ kind: 'outside-hours', arrival: '14:00', departure: '20:00' }, { startTime: '10:15', endTime: '13:15' });
    expect(msg).toContain('10:15');
    expect(msg).toContain('14:00');
  });
  it('has words for every reason', () => {
    for (const kind of ['in-table', 'rejected', 'tentative', 'queued', 'voted', 'has-game-table'] as const) {
      expect(blockedMessage({ kind }, { startTime: '10:00', endTime: '11:00' }).length).toBeGreaterThan(10);
    }
  });
});
