import { describe, expect, it } from 'vitest';
import { countByState, playerTableEntries } from './playerTables';
import type { Table } from './types';

const table = (id: string, o: Partial<Table> = {}): Table =>
  ({ id, gameId: 'g', gameName: id, startTime: '10:00', endTime: '11:00', explainerId: 'x', playerIds: [], status: 'recommended', candidateIds: [], rejectedIds: [], ...o }) as Table;

const states = (tables: Table[], id = 'p1') => playerTableEntries(id, tables).map((e) => `${e.table.id}:${e.state}${e.explains ? ':explains' : ''}`);

describe('playerTableEntries', () => {
  it('tells apart confirmed tables, accepted ones still short of people, and unanswered offers', () => {
    const tables = [
      table('a', { status: 'confirmed', playerIds: ['p1', 'p2'], startTime: '10:00' }),
      table('b', { status: 'recommended', playerIds: ['p1'], candidateIds: ['p2'], startTime: '11:00' }),
      table('c', { status: 'recommended', candidateIds: ['p1', 'p2'], startTime: '12:00' }),
    ];
    expect(states(tables)).toEqual(['a:confirmed', 'b:accepted', 'c:offered']);
  });

  it('counts a table in progress or already played as confirmed', () => {
    expect(states([table('a', { status: 'in-progress', playerIds: ['p1'] }), table('b', { status: 'completed', playerIds: ['p1'] })]))
      .toEqual(['a:confirmed', 'b:confirmed']);
  });

  it('shows a free place offered at a confirmed table as an unanswered offer', () => {
    expect(states([table('a', { status: 'confirmed', playerIds: ['p2', 'p3'], candidateIds: ['p1'] })])).toEqual(['a:offered']);
  });

  it('shows rejected tables and those queued behind an explainer, but never cancelled ones', () => {
    const tables = [
      table('a', { rejectedIds: ['p1'] }),
      table('b', { awaitingExplainer: true, candidateIds: ['p9'], queuedIds: ['p1'], startTime: '11:00' }),
      table('c', { status: 'cancelled', playerIds: ['p1'], candidateIds: ['p1'] }),
    ];
    expect(states(tables)).toEqual(['a:rejected', 'b:queued']);
  });

  it('marks who explains a table, but not while it is still waiting for an explainer (the id is a placeholder)', () => {
    const waiting = table('w', { awaitingExplainer: true, explainerId: 'p1', candidateIds: ['p1'] });
    const set = table('s', { status: 'confirmed', explainerId: 'p1', playerIds: ['p1', 'p2'], startTime: '12:00' });
    expect(states([waiting, set])).toEqual(['w:offered', 's:confirmed:explains']);
  });

  it('only looks at the tables the player is on, sorted by start time, and counts them by state', () => {
    const tables = [
      table('late', { playerIds: ['p1'], status: 'confirmed', startTime: '15:00' }),
      table('early', { playerIds: ['p1'], status: 'confirmed', startTime: '09:00' }),
      table('else', { playerIds: ['p2'], status: 'confirmed' }),
      table('offer', { candidateIds: ['p1'], startTime: '12:00' }),
    ];
    const entries = playerTableEntries('p1', tables);
    expect(entries.map((e) => e.table.id)).toEqual(['early', 'offer', 'late']);
    expect(countByState(entries)).toEqual({ confirmed: 2, accepted: 0, offered: 1, queued: 0, rejected: 0 });
  });

  it('shows the offer of a posted table, and its rejection, the same way', () => {
    expect(states([table('p', { postedByOwner: true, candidateIds: ['p1'] })])).toEqual(['p:offered']);
    expect(states([table('p', { postedByOwner: true, rejectedIds: ['p1'] })])).toEqual(['p:rejected']);
    expect(states([table('p', { postedByOwner: true })])).toEqual([]);
  });
});
