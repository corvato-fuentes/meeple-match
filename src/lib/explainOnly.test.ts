import { describe, expect, it } from 'vitest';
import { asPlayingExplainer, explainBlockMinutes, explainEndFor, isExplainOnly, isInTable, occupiedWindow } from './explainOnly';
import type { Table } from './types';

const table = (over: Partial<Table> = {}): Table => ({
  id: 't1', tableNumber: 1, gameId: 'g1', gameName: 'Brass', startTime: '14:45', endTime: '17:30', explainerId: 'e',
  playerIds: ['a', 'b'], status: 'confirmed', isManuallyEdited: false, batchNumber: 1, ...over,
});

describe('explain-only tables', () => {
  it('knows when the explainer only explains', () => {
    expect(isExplainOnly(table({ explainerPlays: false }))).toBe(true);
    expect(isExplainOnly(table({ explainerPlays: true }))).toBe(false);
    expect(isExplainOnly(table())).toBe(false); // the default: the explainer plays
    expect(isExplainOnly(table({ explainerPlays: false, awaitingExplainer: true }))).toBe(false); // nobody explains it yet
  });

  it('the block is the setup plus the explanation the owner estimated, with a floor, or 30 minutes without data', () => {
    expect(explainBlockMinutes({ setupMinutes: 10, explanationMinutes: 20 })).toBe(30);
    expect(explainBlockMinutes({ setupMinutes: 5, explanationMinutes: 12 })).toBe(20); // rounded up to 5
    expect(explainBlockMinutes({ setupMinutes: 2, explanationMinutes: 3 })).toBe(15); // never shorter than 15
    expect(explainBlockMinutes({ setupMinutes: null, explanationMinutes: null })).toBe(30);
    expect(explainBlockMinutes(undefined)).toBe(30);
  });

  it('the block ends that long after the start, and never after the table itself', () => {
    expect(explainEndFor({ startTime: '14:45', endTime: '17:30' }, { setupMinutes: 10, explanationMinutes: 20 })).toBe('15:15');
    expect(explainEndFor({ startTime: '14:45', endTime: '15:00' }, { setupMinutes: 10, explanationMinutes: 20 })).toBe('15:00');
  });
});

describe('what a table holds of a player', () => {
  it('the whole table for someone seated', () => {
    expect(occupiedWindow(table(), 'a')).toEqual({ start: '14:45', end: '17:30' });
  });
  it('only the explanation for an explainer who only explains', () => {
    const t = table({ explainerPlays: false, explainEndTime: '15:15' });
    expect(occupiedWindow(t, 'e')).toEqual({ start: '14:45', end: '15:15' });
    expect(occupiedWindow(t, 'a')).toEqual({ start: '14:45', end: '17:30' });
  });
  it('the whole table for an explainer who plays (they are seated)', () => {
    expect(occupiedWindow(table({ playerIds: ['e', 'a'] }), 'e')).toEqual({ start: '14:45', end: '17:30' });
  });
  it('nothing for anyone else, for a cancelled table, or for the placeholder explainer of a table still waiting for one', () => {
    expect(occupiedWindow(table(), 'zzz')).toBeNull();
    expect(occupiedWindow(table({ status: 'cancelled' }), 'a')).toBeNull();
    expect(occupiedWindow(table({ awaitingExplainer: true, explainerPlays: false }), 'e')).toBeNull();
  });
  it('falls back to the whole table if the end of the explanation was never stored', () => {
    expect(occupiedWindow(table({ explainerPlays: false }), 'e')).toEqual({ start: '14:45', end: '17:30' });
  });
  it('isInTable: seated, or the explainer who only explains', () => {
    const t = table({ explainerPlays: false, explainEndTime: '15:15' });
    expect(isInTable(t, 'a')).toBe(true);
    expect(isInTable(t, 'e')).toBe(true);
    expect(isInTable(t, 'x')).toBe(false);
  });
  it('whoever takes over explaining goes back to the default', () => {
    expect(asPlayingExplainer('n')).toEqual({ explainerId: 'n', explainerPlays: true, explainEndTime: null });
  });
});
