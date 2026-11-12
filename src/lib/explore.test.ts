import { describe, expect, it } from 'vitest';
import { tablesToExplore } from './explore';
import type { Table } from './types';

const table = (id: string, o: Partial<Table> = {}): Table =>
  ({ id, gameId: 'g1', gameName: id, startTime: '14:00', endTime: '15:00', explainerId: 'x', playerIds: ['x'], status: 'recommended', candidateIds: [], rejectedIds: [], ...o }) as Table;

describe('tablesToExplore — tables the player wants but their agenda has no room for', () => {
  // The player holds a confirmed table of another game from 13:00 to 16:00
  const mine = table('mine', { gameId: 'g9', status: 'confirmed', playerIds: ['me', 'y'], startTime: '13:00', endTime: '16:00' });
  const games = [{ id: 'g1', maxPlayers: 4 }, { id: 'g2', maxPlayers: 4 }, { id: 'g9', maxPlayers: 4 }];
  const run = (tables: Table[], o: Partial<Parameters<typeof tablesToExplore>[0]> = {}) => tablesToExplore({
    playerId: 'me', arrivalTime: '10:00', departureTime: '20:00', interests: { g1: 'yes', g2: 'yes', g9: 'yes' }, repeatGameIds: [], tables, games, bufferMinutes: 10, ...o,
  }).map((e) => e.table.id);

  it('lists a table of a game they want that clashes with one of theirs, and says with which', () => {
    const clashing = table('c', { startTime: '14:00', endTime: '15:00' });
    const out = tablesToExplore({ playerId: 'me', arrivalTime: '10:00', departureTime: '20:00', interests: { g1: 'yes' }, repeatGameIds: [], tables: [mine, clashing], games, bufferMinutes: 10 });
    expect(out).toHaveLength(1);
    expect(out[0].table.id).toBe('c');
    expect(out[0].clash.id).toBe('mine');
  });
  it('the buffer between tables counts: a table starting 5 minutes after theirs ends is a clash', () => {
    expect(run([mine, table('tight', { startTime: '16:05', endTime: '17:00' })])).toEqual(['tight']);
    expect(run([mine, table('ok', { startTime: '16:10', endTime: '17:00' })])).toEqual([]);
  });
  it('does not list a table that fits their agenda (it is offered the usual way), or one of a game they did not vote yes', () => {
    expect(run([mine, table('free', { startTime: '17:00', endTime: '18:00' })])).toEqual([]);
    expect(run([mine, table('other', { gameId: 'g2' })], { interests: { g1: 'yes' } })).toEqual([]);
    expect(run([mine, table('no', { gameId: 'g2' })], { interests: { g2: 'no' } })).toEqual([]);
  });
  it('not tables that are full, cancelled, underway, waiting for an explainer, theirs, or that they turned down', () => {
    expect(run([mine, table('full', { playerIds: ['a', 'b', 'c', 'd'] })])).toEqual([]);
    expect(run([mine, table('cancelled', { status: 'cancelled' })])).toEqual([]);
    expect(run([mine, table('underway', { status: 'in-progress' })])).toEqual([]);
    expect(run([mine, table('waiting', { awaitingExplainer: true })])).toEqual([]);
    expect(run([mine, table('seated', { playerIds: ['x', 'me'] })])).toEqual([]);
    expect(run([mine, table('declined', { rejectedIds: ['me'] })])).toEqual([]);
  });
  it('not a table outside the hours they are there, nor one of a game they already have a table of (unless they would play two)', () => {
    expect(run([mine, table('late', { startTime: '15:00', endTime: '22:00' })])).toEqual([]);
    const theirGame = table('theirs', { gameId: 'g1', status: 'confirmed', playerIds: ['me', 'z'], startTime: '10:30', endTime: '11:30' });
    expect(run([mine, theirGame, table('again', { gameId: 'g1' })])).toEqual([]);
    expect(run([mine, theirGame, table('again', { gameId: 'g1' })], { repeatGameIds: ['g1'] })).toEqual(['again']);
  });
  it('nothing to explore with an empty agenda; the rest are sorted by time', () => {
    expect(run([table('a')])).toEqual([]);
    expect(run([mine, table('late', { startTime: '15:00', endTime: '15:30' }), table('early', { gameId: 'g2', startTime: '13:30', endTime: '14:30' })])).toEqual(['early', 'late']);
  });
});
