import { describe, expect, it } from 'vitest';
import { generateTables, reviewWaitingTables } from './tableAlgorithm';
import type { Game, Player, Table } from './types';

const player = (id: string, o: Partial<Player> = {}): Player =>
  ({
    id, name: id, firstName: id, lastName: '', alias: null, email: null, phone: null, arrivalTime: '10:00', departureTime: '20:00',
    ticketCode: id.toUpperCase(), bringGameIds: [], interests: {}, canExplain: [], playedGameIds: [], repeatGameIds: [], paymentProofUrl: null, ...o,
  }) as Player;

const game = (id: string, o: Partial<Game> = {}): Game =>
  ({ id, name: id, bggUrl: null, minPlayers: 2, maxPlayers: 4, durationMinutes: 60, complexity: 'medium', ownerPlayerId: 'nobody', ownerName: 'Nadie', ...o }) as Game;

// "a" is in a table of g1 from 11:00 to 13:00; the other two seated there (x, y) are not part of this event's players
const longTable = (aOnlyExplains: boolean): Table => ({
  id: 'long', tableNumber: 1, gameId: 'g1', gameName: 'g1', startTime: '11:00', endTime: '13:00', explainerId: 'a',
  playerIds: aOnlyExplains ? ['x', 'y'] : ['a', 'x', 'y'], status: 'confirmed', isManuallyEdited: false, batchNumber: 1,
  ...(aOnlyExplains ? { explainerPlays: false, explainEndTime: '11:30' } : {}),
}) as Table;

// Three people who all want g2 and can explain it, so every one of them is offered the table
const people = () => ['a', 'b', 'c'].map((id) => player(id, { interests: { g2: 'yes' }, canExplain: ['g2'] }));
const startsFor = (id: string, tables: Table[]) => tables.filter((t) => [...(t.candidateIds ?? []), ...(t.queuedIds ?? []), ...t.playerIds].includes(id)).map((t) => t.startTime);

describe('an explainer who only explains is free for the rest of the table', () => {
  const run = (aOnlyExplains: boolean) =>
    generateTables(people(), [game('g1'), game('g2')], [longTable(aOnlyExplains)], 10, null, 1, []);

  it('is offered a new table that overlaps the rest of the one they only explain', () => {
    const { proposals } = run(true);
    const starts = startsFor('a', proposals as unknown as Table[]);
    expect(starts.length).toBeGreaterThan(0);
    expect(starts.some((s) => s < '13:00')).toBe(true); // before the long table is over: only the explanation holds them
  });

  it('whereas someone seated for the whole table is not offered anything until it is over', () => {
    const { proposals } = run(false);
    const starts = startsFor('a', proposals as unknown as Table[]);
    expect(starts.every((s) => s >= '13:10')).toBe(true);
  });
});

describe('a waiting table they were offered to explain keeps them if it only overlaps the rest', () => {
  it('reviewWaitingTables does not drop them for a clash with the part they are free for', () => {
    // b can explain g2 at 12:00; "a" only explains the long table until 11:30, so a table of g2 at 12:00 is still fine for them
    const waiting: Table = {
      id: 'w', tableNumber: 2, gameId: 'g2', gameName: 'g2', startTime: '12:00', endTime: '13:00', explainerId: 'a', playerIds: [],
      status: 'recommended', isManuallyEdited: false, batchNumber: 1, awaitingExplainer: true, candidateIds: ['a'], queuedIds: ['b'], rejectedIds: [],
    } as Table;
    expect(reviewWaitingTables(people(), [longTable(true), waiting], 10)).toEqual([]);
    // seated for the whole table they could not do it: the table loses its only explainer and is cancelled
    expect(reviewWaitingTables(people(), [longTable(false), waiting], 10)).toEqual([{ tableId: 'w', action: 'cancel' }]);
  });
});
