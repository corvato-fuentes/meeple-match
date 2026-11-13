import { describe, expect, it } from 'vitest';
import { findConflictingTables, tablesOutsideAvailability } from './tableAlgorithm';
import { pickNextTable } from './nextTable';
import { playerTableEntries } from './playerTables';
import { seatOptionFor } from './freeSeats';
import type { Game, Player, Table } from './types';

// Brass 14:45–17:30 with two players; "e" explains it but only explains, until 15:15
const brass = (over: Partial<Table> = {}): Table => ({
  id: 'brass', tableNumber: 1, gameId: 'g1', gameName: 'Brass', startTime: '14:45', endTime: '17:30', explainerId: 'e',
  playerIds: ['a', 'b'], status: 'confirmed', isManuallyEdited: false, batchNumber: 1,
  explainerPlays: false, explainEndTime: '15:15', ...over,
});
const other = (over: Partial<Table> = {}): Table => ({
  id: 'dune', tableNumber: 2, gameId: 'g2', gameName: 'Dune', startTime: '16:00', endTime: '18:00', explainerId: 'x',
  playerIds: ['x', 'e'], status: 'confirmed', isManuallyEdited: false, batchNumber: 1, ...over,
});

describe('an explainer who only explains is held just for the explanation', () => {
  it('another table after the explanation is no clash, though the table itself is still running', () => {
    expect(findConflictingTables('e', '16:00', '18:00', [brass()])).toEqual([]);
  });
  it('another table during the explanation is a clash', () => {
    expect(findConflictingTables('e', '15:00', '16:00', [brass()]).map((t) => t.id)).toEqual(['brass']);
  });
  it('the players of the same table are held for all of it', () => {
    expect(findConflictingTables('a', '16:00', '18:00', [brass()]).map((t) => t.id)).toEqual(['brass']);
  });
  it('the explainer who plays is held for all of it (their table is seated)', () => {
    expect(findConflictingTables('e', '16:00', '18:00', [brass({ explainerPlays: true, explainEndTime: null, playerIds: ['e', 'a'] })]).map((t) => t.id)).toEqual(['brass']);
  });
});

describe('arrival and departure', () => {
  it('only the explanation has to fit inside the hours of someone who only explains', () => {
    // leaves at 16:00: the table runs until 17:30 but the explainer is only there until 15:15
    const args = { tables: [brass()], arrivalTime: '10:00', departureTime: '16:00', bufferMinutes: 15 };
    expect(tablesOutsideAvailability({ ...args, playerId: 'e' })).toEqual([]);
    expect(tablesOutsideAvailability({ ...args, playerId: 'a' }).map((t) => t.id)).toEqual(['brass']);
    // leaves before the explanation is over
    expect(tablesOutsideAvailability({ ...args, departureTime: '15:00', playerId: 'e' }).map((t) => t.id)).toEqual(['brass']);
  });
});

describe('the next table of the explainer', () => {
  const day = '2026-11-15';
  const at = (hhmm: string) => new Date(`${day}T${hhmm}:00`);
  it('is running only until the explanation ends, then the next one comes', () => {
    const tables = [brass(), other()];
    expect(pickNextTable(tables, day, at('15:00'), 'e')).toMatchObject({ kind: 'live', table: { id: 'brass' }, minutesLeft: 15 });
    expect(pickNextTable(tables, day, at('15:30'), 'e')).toMatchObject({ table: { id: 'dune' } });
  });
  it('stays running until the end of the table for the people playing it', () => {
    expect(pickNextTable([brass()], day, at('15:30'), 'a')).toMatchObject({ kind: 'live', table: { id: 'brass' }, minutesLeft: 120 });
  });
});

describe('where the explainer shows up', () => {
  it('the admin\'s view of a player lists the table they only explain', () => {
    const entries = playerTableEntries('e', [brass()]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ state: 'confirmed', explains: true });
  });
  it('they are in the table for the board: no free place is offered to them there', () => {
    const game = { id: 'g1', name: 'Brass', minPlayers: 2, maxPlayers: 4 } as Game;
    const viewer = { id: 'e', arrivalTime: '10:00', departureTime: '20:00', repeatGameIds: [], interests: {} } as unknown as Player;
    const option = seatOptionFor({ viewer, table: brass(), game, tables: [brass()], started: false });
    expect(option).toEqual({ kind: 'blocked', reason: { kind: 'in-table' } });
  });
});
