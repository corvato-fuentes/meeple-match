import { describe, expect, it } from 'vitest';
import { explainersToAskAfterLeave } from './tableAlgorithm';
import type { Player, Table } from './types';

const player = (id: string, o: Partial<Player> = {}): Player =>
  ({
    id, name: id, firstName: id, lastName: '', alias: null, email: null, phone: null, arrivalTime: '10:00', departureTime: '20:00',
    ticketCode: id.toUpperCase(), bringGameIds: [], interests: { g1: 'yes' }, canExplain: ['g1'], playedGameIds: [], repeatGameIds: [], paymentProofUrl: null, ...o,
  }) as Player;

const table = (o: Partial<Table> = {}): Table =>
  ({
    id: 't1', tableNumber: 1, gameId: 'g1', gameName: 'g1', startTime: '12:00', endTime: '14:00', explainerId: 'leaver', playerIds: ['leaver', 's1'],
    status: 'recommended', isManuallyEdited: false, batchNumber: 1, rejectedIds: [], ...o,
  }) as Table;

describe('who is asked to explain a table whose explainer left', () => {
  it('asks the game\'s other explainers who voted it and are free', () => {
    const players = [player('leaver'), player('s1'), player('a'), player('b')];
    expect(explainersToAskAfterLeave(table(), 'leaver', players, [table()], 10)).toEqual(['a', 'b']);
  });

  it('leaves out the one who left, the ones already seated, and the ones who did not vote the game or cannot explain it', () => {
    const players = [
      player('leaver'), player('s1'), player('noVote', { interests: {} }), player('noTeach', { canExplain: [] }), player('ok'),
    ];
    expect(explainersToAskAfterLeave(table(), 'leaver', players, [table()], 10)).toEqual(['ok']);
  });

  it('leaves out someone who turned the table down, and someone busy with another table at that time', () => {
    const busy: Table = { ...table({ id: 't2' }), gameId: 'g2', startTime: '12:30', endTime: '13:30', playerIds: ['busy'] } as Table;
    const players = [player('turnedDown'), player('busy'), player('free')];
    expect(explainersToAskAfterLeave(table({ rejectedIds: ['turnedDown'] }), 'leaver', players, [table(), busy], 10)).toEqual(['free']);
  });

  it('is empty when nobody else can: the table is then cancelled', () => {
    expect(explainersToAskAfterLeave(table(), 'leaver', [player('leaver'), player('s1')], [table()], 10)).toEqual([]);
  });
});
