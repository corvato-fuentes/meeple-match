import { describe, expect, it } from 'vitest';
import {
  computeIdleGaps, estimatedDuration, estimatedDurationRange, findConflictingTable, generateTables, overlaps,
  reviewWaitingTables, postedSlotConflict, replaceableByPostedTable, sameGameOverlaps, interestedInTable, expectedTableEnd,
} from './tableAlgorithm';
import type { Game, Player, Table } from './types';

// ── fixtures ────────────────────────────────────────────────────────────────
const player = (id: string, o: Partial<Player> = {}): Player =>
  ({
    id, name: id, firstName: id, lastName: '', alias: null, email: null, phone: null, arrivalTime: '10:00', departureTime: '20:00',
    ticketCode: id.toUpperCase(), bringGameIds: [], interests: {}, canExplain: [], playedGameIds: [], repeatGameIds: [], paymentProofUrl: null, ...o,
  }) as Player;

// ownerPlayerId defaults to someone who isn't registered, so the "owner must be present" rule doesn't interfere
const game = (id: string, o: Partial<Game> = {}): Game =>
  ({ id, name: id, bggUrl: null, minPlayers: 2, maxPlayers: 4, durationMinutes: 60, complexity: 'medium', ownerPlayerId: 'nobody', ownerName: 'Nadie', ...o }) as Game;

const table = (id: string, o: Partial<Table> = {}): Table =>
  ({
    id, tableNumber: 1, gameId: 'g1', gameName: 'g1', startTime: '10:00', endTime: '11:00', explainerId: 'p1', playerIds: [],
    status: 'recommended', isManuallyEdited: false, batchNumber: 1, candidateIds: [], rejectedIds: [], ...o,
  }) as Table;

/** Everyone a proposed table was built for — whoever is seated, offered it, or queued behind the explainer — sorted. */
const seated = (t: { playerIds: string[]; candidateIds: string[]; queuedIds?: string[] }) =>
  [...new Set([...t.playerIds, ...t.candidateIds, ...(t.queuedIds ?? [])])].sort();

/** n players who all want game g1; the first one can explain it. */
const voters = (n: number, gameId = 'g1', o: Partial<Player> = {}) =>
  Array.from({ length: n }, (_, i) =>
    player(`p${i + 1}`, { interests: { [gameId]: 'yes' }, canExplain: i === 0 ? [gameId] : [], ...o }));

const generate = (players: Player[], games: Game[], existing: Table[] = [], { buffer = 10, physical = null as number | null, breaks = [] as { start: string; end: string }[] } = {}) =>
  generateTables(players, games, existing, buffer, physical, 1, breaks);

// ── small helpers ───────────────────────────────────────────────────────────
describe('overlaps / findConflictingTable', () => {
  it('overlaps is true only for real overlap — touching windows do not overlap', () => {
    expect(overlaps('10:00', '11:00', '10:30', '11:30')).toBe(true);
    expect(overlaps('10:00', '11:00', '11:00', '12:00')).toBe(false);
    expect(overlaps('10:00', '11:00', '12:00', '13:00')).toBe(false);
  });
  it('finds the table the player is already at that overlaps, ignoring cancelled ones and the table itself', () => {
    const tables = [
      table('mine', { playerIds: ['p1'], startTime: '10:00', endTime: '11:00' }),
      table('cancelled', { playerIds: ['p1'], startTime: '12:00', endTime: '13:00', status: 'cancelled' }),
      table('other', { playerIds: ['p2'], startTime: '10:00', endTime: '11:00' }),
    ];
    expect(findConflictingTable('p1', '10:30', '11:30', tables)?.id).toBe('mine');
    expect(findConflictingTable('p1', '10:30', '11:30', tables, 'mine')).toBeNull();
    expect(findConflictingTable('p1', '12:00', '13:00', tables)).toBeNull();
    expect(findConflictingTable('p3', '10:30', '11:30', tables)).toBeNull();
  });
});

describe('estimatedDuration', () => {
  it('rounds a flat duration up to a multiple of 5', () => {
    expect(estimatedDuration(game('g', { durationMinutes: 38 }), 3)).toBe(40);
    expect(estimatedDuration(game('g', { durationMinutes: 40 }), 3)).toBe(40);
  });
  it('uses setup + explanation + per-player time when the game has them', () => {
    const g = game('g', { setupMinutes: 10, explanationMinutes: 15, perPlayerMinutes: 20, durationMinutes: 999 });
    expect(estimatedDuration(g, 2)).toBe(65);
    expect(estimatedDuration(g, 4)).toBe(105);
    expect(estimatedDurationRange(g)).toEqual([estimatedDuration(g, 2), estimatedDuration(g, 4)]);
  });
});

// ── generateTables ──────────────────────────────────────────────────────────
describe('generateTables — forming a table', () => {
  it('proposes a table for everyone interested, led by someone who can explain it', () => {
    const { proposals } = generate(voters(4), [game('g1')]);
    expect(proposals).toHaveLength(1);
    const t = proposals[0];
    expect(t.explainerId).toBe('p1');
    expect(t.status).toBe('recommended');
    expect(seated(t)).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('offers the table FIRST to the people who can explain it — the rest wait in a queue and are not offered it yet', () => {
    const [t] = generate(voters(4), [game('g1')]).proposals;
    expect(t.awaitingExplainer).toBe(true);
    expect(t.candidateIds).toEqual(['p1']);                     // p1 is the only one who can explain it
    expect(t.queuedIds.sort()).toEqual(['p2', 'p3', 'p4']);     // everybody else waits for them
    expect(t.explainerId).toBe('p1');                           // provisional
    expect(t.playerIds).toEqual([]);
    expect(t.rejectedIds).toEqual([]);
  });

  it('asks everyone who can explain the game at the same time, not one after another', () => {
    const players = voters(4).map((p) => (p.id === 'p3' ? { ...p, canExplain: ['g1'] } : p));
    const [t] = generate(players, [game('g1')]).proposals;
    expect(t.candidateIds.sort()).toEqual(['p1', 'p3']);
    expect(t.queuedIds.sort()).toEqual(['p2', 'p4']);
  });

  it('a game that allows one player still needs two people — this is a social event', () => {
    expect(generate(voters(1), [game('g1', { minPlayers: 1, maxPlayers: 4 })]).proposals).toHaveLength(0);
    const [t] = generate(voters(2), [game('g1', { minPlayers: 1, maxPlayers: 4 })]).proposals;
    expect(t.status).toBe('recommended');
    expect(seated(t)).toEqual(['p1', 'p2']);
  });

  it('does not offer someone to explain a game again after they declined it (the table was cancelled)', () => {
    const cancelled = table('t0', { gameId: 'g1', status: 'cancelled', awaitingExplainer: true, rejectedIds: ['p1'], candidateIds: [], queuedIds: [] });
    const players = voters(3).map((p) => (p.id === 'p2' ? { ...p, canExplain: ['g1'] } : p));
    const { proposals } = generate(players, [game('g1')], [cancelled]);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].explainerId).toBe('p2');
  });

  it('starts after arrival plus the buffer (rounded up to the 15-minute grid) and lasts the game duration', () => {
    const { proposals } = generate(voters(3), [game('g1', { durationMinutes: 60 })], [], { buffer: 10 });
    expect(proposals[0].startTime).toBe('10:15'); // 10:00 + 10 min buffer → 10:10 → grid 10:15
    expect(proposals[0].endTime).toBe('11:15');
  });

  it('needs at least the minimum number of interested players', () => {
    expect(generate(voters(1), [game('g1', { minPlayers: 2 })]).proposals).toHaveLength(0);
    expect(generate(voters(2), [game('g1', { minPlayers: 3 })]).proposals).toHaveLength(0);
  });

  it('needs someone who can explain the game', () => {
    const noOne = voters(4).map((p) => ({ ...p, canExplain: [] }));
    expect(generate(noOne, [game('g1')]).proposals).toHaveLength(0);
  });

  it('only counts "yes" votes', () => {
    const players = voters(4).map((p, i) => (i >= 2 ? { ...p, interests: { g1: 'no' as const } } : p));
    expect(generate(players, [game('g1', { minPlayers: 3 })]).proposals).toHaveLength(0);
  });

  it('never seats more than the game maximum, and the rest form their own table if they are enough', () => {
    const players = voters(6).map((p, i) => (i === 4 ? { ...p, canExplain: ['g1'] } : p));
    const { proposals } = generate(players, [game('g1', { minPlayers: 2, maxPlayers: 4 })]);
    expect(proposals).toHaveLength(2);
    expect(seated(proposals[0])).toHaveLength(4);
    expect(seated(proposals[1])).toHaveLength(2);
    expect(new Set([...seated(proposals[0]), ...seated(proposals[1])]).size).toBe(6); // nobody twice
  });
});

describe('generateTables — availability', () => {
  it('leaves out a player whose hours do not fit, without sinking the table for the others', () => {
    const players = voters(4);
    players[3] = { ...players[3], arrivalTime: '18:00', departureTime: '19:00' }; // can't play 10:15–11:15
    const { proposals } = generate(players, [game('g1', { minPlayers: 3 })]);
    expect(proposals).toHaveLength(1);
    expect(seated(proposals[0])).not.toContain('p4');
    expect(seated(proposals[0])).toHaveLength(3);
  });

  it('respects the departure time', () => {
    const players = voters(2).map((p) => ({ ...p, departureTime: '10:45' })); // leave before a 60-minute game could end
    expect(generate(players, [game('g1', { durationMinutes: 60 })]).proposals).toHaveLength(0);
  });

  it('does not schedule across a break: the table starts after it', () => {
    const { proposals } = generate(voters(2), [game('g1', { durationMinutes: 120 })], [], {
      buffer: 10, breaks: [{ start: '12:00', end: '13:00' }],
    });
    expect(proposals).toHaveLength(1);
    expect(proposals[0].startTime).toBe('13:15'); // 13:00 + buffer → 13:10 → grid 13:15
  });

  it('puts a table before a break when it fits there', () => {
    const { proposals } = generate(voters(2), [game('g1', { durationMinutes: 60 })], [], { buffer: 10, breaks: [{ start: '12:00', end: '13:00' }] });
    expect(proposals[0].startTime).toBe('10:15');
  });

  it('keeps a buffer after the tables a player is already seated at', () => {
    const existing = [table('t1', { gameId: 'other', playerIds: ['p1', 'p2'], status: 'confirmed', startTime: '10:15', endTime: '11:15' })];
    const { proposals } = generate(voters(2), [game('g1', { durationMinutes: 60 })], existing, { buffer: 10 });
    expect(proposals[0].startTime).toBe('11:30'); // 11:15 + 10 → 11:25 → grid 11:30
  });
});

describe('generateTables — resources', () => {
  it('with one physical table, the second game waits for the first to finish (plus buffer)', () => {
    const players = [
      ...voters(2, 'g1'),
      ...[3, 4].map((n, i) => player(`p${n}`, { interests: { g2: 'yes' }, canExplain: i === 0 ? ['g2'] : [] })),
    ];
    const { proposals } = generate(players, [game('g1', { durationMinutes: 60 }), game('g2', { durationMinutes: 60 })], [], { buffer: 10, physical: 1 });
    expect(proposals).toHaveLength(2);
    const [a, b] = [...proposals].sort((x, y) => x.startTime.localeCompare(y.startTime));
    expect(a.endTime <= b.startTime).toBe(true);
  });

  it('with enough physical tables, both games can run at the same time', () => {
    const players = [
      ...voters(2, 'g1'),
      ...[3, 4].map((n, i) => player(`p${n}`, { interests: { g2: 'yes' }, canExplain: i === 0 ? ['g2'] : [] })),
    ];
    const { proposals } = generate(players, [game('g1'), game('g2')], [], { buffer: 10, physical: 2 });
    expect(proposals.map((p) => p.startTime)).toEqual(['10:15', '10:15']);
  });

  it('waits for the owner to arrive: the game cannot start before its owner brought it', () => {
    const owner = player('owner', { arrivalTime: '14:00', departureTime: '20:00', interests: { g1: 'yes' }, canExplain: ['g1'] });
    const players = [...voters(2).map((p) => ({ ...p, canExplain: [] })), owner];
    const { proposals } = generate(players, [game('g1', { ownerPlayerId: 'owner' })]);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].startTime >= '14:00').toBe(true);
    expect(seated(proposals[0])).toContain('owner'); // not lent out: the owner has to sit at the table
  });
});

describe('generateTables — what was already offered', () => {
  it('does not offer a table again to someone who already has an open offer for the game', () => {
    const existing = [table('open', { gameId: 'g1', candidateIds: ['p1', 'p2'], startTime: '10:15', endTime: '11:15' })];
    const { proposals } = generate(voters(2), [game('g1', { maxPlayers: 4 })], existing);
    expect(proposals).toHaveLength(0);
  });

  it('adds a late voter who fits to an open recommended table without moving it', () => {
    const existing = [table('open', { gameId: 'g1', candidateIds: ['p1', 'p2'], startTime: '10:15', endTime: '11:15' })];
    const { proposals, candidateUpdates } = generate(voters(3), [game('g1', { maxPlayers: 4 })], existing);
    expect(proposals).toHaveLength(0);
    expect(candidateUpdates).toEqual([{ tableId: 'open', candidateIds: ['p1', 'p2', 'p3'] }]);
  });

  it('a late voter for a table still waiting on its explainer joins the queue, not the offer', () => {
    const existing = [table('open', { gameId: 'g1', awaitingExplainer: true, candidateIds: ['p1'], queuedIds: ['p2'], startTime: '10:15', endTime: '11:15' })];
    const { proposals, candidateUpdates } = generate(voters(3), [game('g1', { maxPlayers: 4 })], existing);
    expect(proposals).toHaveLength(0);
    expect(candidateUpdates).toEqual([{ tableId: 'open', queuedIds: ['p2', 'p3'] }]);
  });

  it('offers a late voter a free place at a CONFIRMED table — they are not seated, they have to accept', () => {
    const confirmed = table('c1', { gameId: 'g1', status: 'confirmed', playerIds: ['p1', 'p2'], candidateIds: [], startTime: '12:00', endTime: '13:00' });
    const { proposals, candidateUpdates } = generate([...voters(2), player('p3', { interests: { g1: 'yes' } })], [game('g1', { maxPlayers: 4 })], [confirmed]);
    expect(proposals).toHaveLength(0);
    expect(candidateUpdates).toEqual([{ tableId: 'c1', candidateIds: ['p3'] }]);
  });

  it('offers nothing for a confirmed table that is full, or to someone who stepped down from it', () => {
    const full = table('c1', { gameId: 'g1', status: 'confirmed', playerIds: ['p1', 'p2'], startTime: '12:00', endTime: '13:00' });
    expect(generate([...voters(2), player('p3', { interests: { g1: 'yes' } })], [game('g1', { maxPlayers: 2 })], [full]).candidateUpdates).toEqual([]);
    const left = { ...full, rejectedIds: ['p3'] };
    expect(generate([...voters(2), player('p3', { interests: { g1: 'yes' } })], [game('g1', { maxPlayers: 4 })], [left]).candidateUpdates).toEqual([]);
  });

  it('offers a table an owner posted to the people who voted that game and fit its slot', () => {
    const posted = table('post', { gameId: 'g1', postedByOwner: true, status: 'recommended', explainerId: 'p1', playerIds: ['p1'], startTime: '12:00', endTime: '13:00' });
    const players = [
      player('p1', { interests: { g1: 'yes' }, canExplain: ['g1'] }),
      player('p2', { interests: { g1: 'yes' } }),
      player('p3', { interests: { g1: 'yes' }, departureTime: '12:30' }), // leaves before it ends
      player('p4', { interests: { g1: 'no' } }),
    ];
    const { candidateUpdates } = generate(players, [game('g1', { maxPlayers: 4 })], [posted]);
    expect(candidateUpdates).toEqual([{ tableId: 'post', candidateIds: ['p2'] }]);
  });

  it('does not offer a posted table to someone already seated at another table of that game, unless they would join a second one', () => {
    const posted = table('post', { gameId: 'g1', postedByOwner: true, status: 'recommended', explainerId: 'p1', playerIds: ['p1'], startTime: '16:00', endTime: '17:00' });
    const other = table('other', { gameId: 'g1', status: 'confirmed', playerIds: ['p2', 'p3'], startTime: '10:00', endTime: '11:00' });
    const players = [
      player('p1', { interests: { g1: 'yes' }, canExplain: ['g1'] }),
      player('p2', { interests: { g1: 'yes' } }),
      player('p3', { interests: { g1: 'yes' }, repeatGameIds: ['g1'] }),
    ];
    expect(generate(players, [game('g1', { maxPlayers: 6, minPlayers: 2 })], [posted, other]).candidateUpdates).toContainEqual({ tableId: 'post', candidateIds: ['p3'] });
  });

  it('does not re-offer a player who rejected the open table', () => {
    const existing = [table('open', { gameId: 'g1', candidateIds: ['p1'], rejectedIds: ['p3'], startTime: '10:15', endTime: '11:15' })];
    const { candidateUpdates } = generate(voters(3), [game('g1', { maxPlayers: 4 })], existing);
    expect(candidateUpdates[0]?.candidateIds ?? []).not.toContain('p3');
  });

  it('ignores cancelled tables when deciding who was offered', () => {
    const existing = [table('gone', { gameId: 'g1', candidateIds: ['p1', 'p2'], status: 'cancelled' })];
    expect(generate(voters(2), [game('g1')], existing).proposals).toHaveLength(1);
  });
});

// ── postedSlotConflict ──────────────────────────────────────────────────────
describe('postedSlotConflict — posting next to a table that already exists', () => {
  const existing = table('e', { gameId: 'g1', status: 'confirmed', startTime: '14:00', endTime: '15:30' });
  const check = (o: Partial<Parameters<typeof postedSlotConflict>[0]> = {}) =>
    postedSlotConflict({ tables: [existing], gameId: 'g1', start: '14:30', end: '16:00', bufferMinutes: 10, gameCopies: 1, physicalTables: null, ...o });

  it('refuses a slot that overlaps another table of the same game when there is a single copy', () => {
    expect(check()).toEqual({ kind: 'copy', table: existing });
  });
  it('also needs the buffer between two tables of the same copy, on both sides', () => {
    expect(check({ start: '15:35', end: '16:30' })).not.toBeNull(); // starts 5 min after the other ends: box not reset yet
    expect(check({ start: '15:40', end: '16:30' })).toBeNull();
    expect(check({ start: '12:30', end: '13:55' })).not.toBeNull();  // ends 5 min before the other starts
    expect(check({ start: '12:30', end: '13:45' })).toBeNull();
  });
  it('lets two tables of the game run at once when there are two copies', () => {
    expect(check({ gameCopies: 2 })).toBeNull();
    expect(check({ gameCopies: 2, tables: [existing, { ...existing, id: 'e2' }] })).not.toBeNull();
  });
  it('only a CONFIRMED table blocks: one still waiting for people, or cancelled, does not', () => {
    expect(check({ tables: [{ ...existing, status: 'recommended' }] })).toBeNull();
    expect(check({ tables: [{ ...existing, status: 'in-progress' }] })).not.toBeNull();
    expect(check({ tables: [{ ...existing, status: 'cancelled' }] })).toBeNull();
  });
  it('ignores other games', () => {
    expect(check({ gameId: 'g2' })).toBeNull();
  });
  it('refuses a slot when every physical table of the venue is taken at that time', () => {
    const other = table('o', { gameId: 'g9', status: 'confirmed', startTime: '14:00', endTime: '16:00' });
    expect(check({ gameId: 'g2', tables: [other], physicalTables: 1 })).toEqual({ kind: 'physical' });
    expect(check({ gameId: 'g2', tables: [other], physicalTables: 2 })).toBeNull();
  });
});

// ── replaceableByPostedTable ────────────────────────────────────────────────
describe('replaceableByPostedTable — suggestions a posted table takes the place of', () => {
  const suggested = table('s', { gameId: 'g1', status: 'recommended', startTime: '14:00', endTime: '15:30' });
  const find = (o: Partial<Parameters<typeof replaceableByPostedTable>[0]> = {}) =>
    replaceableByPostedTable({ tables: [suggested], gameId: 'g1', start: '14:30', end: '16:00', bufferMinutes: 10, gameCopies: 1, ...o });

  it('an overlapping suggestion of the same game is replaced (buffer counted on both sides)', () => {
    expect(find()).toEqual([suggested]);
    expect(find({ start: '15:35', end: '16:30' })).toEqual([suggested]);
    expect(find({ start: '15:40', end: '16:30' })).toEqual([]);
  });
  it('leaves alone other games, confirmed tables, cancelled ones and tables other people posted', () => {
    expect(find({ gameId: 'g2' })).toEqual([]);
    expect(find({ tables: [{ ...suggested, status: 'confirmed' }] })).toEqual([]);
    expect(find({ tables: [{ ...suggested, status: 'cancelled' }] })).toEqual([]);
    expect(find({ tables: [{ ...suggested, postedByOwner: true }] })).toEqual([]);
  });
  it('replaces nothing while another copy of the game is free for the suggestion', () => {
    expect(find({ gameCopies: 2 })).toEqual([]);
    expect(find({ gameCopies: 2, tables: [suggested, { ...suggested, id: 'c', status: 'confirmed' }] })).toEqual([suggested]);
  });
});

// ── interestedInTable ───────────────────────────────────────────────────────
describe('interestedInTable — who is interested in a table, offered or not yet', () => {
  const posted = table('post', { gameId: 'g1', postedByOwner: true, playerIds: ['p1'], startTime: '12:00', endTime: '13:00', candidateIds: ['p5'] });
  const players = [
    player('p1', { interests: { g1: 'yes' } }),                                   // seated: not "interested", already in
    player('p2', { interests: { g1: 'yes' } }),                                   // votes and fits, no offer written yet
    player('p3', { interests: { g1: 'yes' }, departureTime: '12:30' }),           // leaves before it ends
    player('p4', { interests: { g1: 'no' } }),
    player('p5', { interests: {} }),                                              // was offered it
    player('p6', { interests: { g1: 'yes' } }),                                   // already seated at another table of the game
  ];
  const other = table('o', { gameId: 'g1', status: 'confirmed', playerIds: ['p6'], startTime: '16:00', endTime: '17:00' });
  const rows = (t = posted, extra: Table[] = []) => interestedInTable(t, players, [t, other, ...extra], 10).map((r) => r.player.id + (r.busy ? ':busy' : ''));

  it('lists everyone who voted yes plus the ones it was offered to, marking those who can not take it as busy', () => {
    // p3 leaves before it ends and p6 already has a table of the game: still interested, but busy
    expect(rows()).toEqual(['p2', 'p3:busy', 'p5', 'p6:busy']);
  });
  it('leaves out those seated in it, those who voted against and those who declined that table', () => {
    expect(rows({ ...posted, rejectedIds: ['p2'] })).toEqual(['p3:busy', 'p5', 'p6:busy']);
  });
  it('someone at another table at that time is busy', () => {
    expect(rows(posted, [table('x', { gameId: 'g2', status: 'confirmed', playerIds: ['p2'], startTime: '12:30', endTime: '13:30' })])).toContain('p2:busy');
  });
});

// ── expectedTableEnd ────────────────────────────────────────────────────────
describe('expectedTableEnd — when a table should end for the people it is for', () => {
  // setup 15 + explanation 30 + 30 per player: 2 players 105 min, 4 players 165 min
  const dune = game('g1', { minPlayers: 2, maxPlayers: 4, setupMinutes: 15, explanationMinutes: 30, perPlayerMinutes: 30, durationMinutes: 165 });
  const t = (o: Partial<Table> = {}) => table('t', { startTime: '14:45', playerIds: ['a', 'b', 'c', 'd'], ...o });

  it('sizes a table the algorithm built for who is seated plus who is still offered it', () => {
    expect(expectedTableEnd(t(), dune)).toBe('17:30');
    expect(expectedTableEnd(t({ playerIds: ['a', 'b'] }), dune)).toBe('16:30');
    expect(expectedTableEnd(t({ playerIds: ['a', 'b'], candidateIds: ['c'], rejectedIds: [] }), dune)).toBe('17:00');
  });
  it('never goes under the minimum seats of the game nor over its maximum, and ignores whoever declined', () => {
    expect(expectedTableEnd(t({ playerIds: [] }), dune)).toBe('16:30');
    expect(expectedTableEnd(t({ playerIds: ['a', 'b', 'c'], candidateIds: ['d', 'e', 'f'] }), dune)).toBe('17:30');
    expect(expectedTableEnd(t({ playerIds: ['a', 'b'], candidateIds: ['c'], rejectedIds: ['c'] }), dune)).toBe('16:30');
  });
  it('a table an owner posted keeps the whole duration of the game', () => {
    expect(expectedTableEnd(t({ postedByOwner: true, playerIds: ['a'] }), dune)).toBe('17:30');
  });
  it('is capped at the end of the day', () => {
    expect(expectedTableEnd(t({ startTime: '23:00' }), dune)).toBe('23:59');
  });
  it('a confirmed table lasts what the game takes for who is seated, not for who is only offered it', () => {
    const confirmed = (o: Partial<Table> = {}) => t({ status: 'confirmed', ...o });
    expect(expectedTableEnd(confirmed({ playerIds: ['a', 'b'], candidateIds: ['c', 'd'] }), dune)).toBe('16:30');
    expect(expectedTableEnd(confirmed({ playerIds: ['a', 'b', 'c'] }), dune)).toBe('17:00');
    expect(expectedTableEnd(confirmed({ postedByOwner: true, playerIds: ['a', 'b'] }), dune)).toBe('16:30');
  });
});

// ── sameGameOverlaps ────────────────────────────────────────────────────────
describe('sameGameOverlaps — same game running twice with one copy', () => {
  const a = table('a', { gameId: 'g1', status: 'confirmed', startTime: '14:00', endTime: '15:30' });
  const b = table('b', { gameId: 'g1', status: 'recommended', startTime: '15:00', endTime: '16:30' });
  const find = (o: Partial<Parameters<typeof sameGameOverlaps>[0]> = {}) =>
    sameGameOverlaps({ tables: [a, b], table: b, start: b.startTime, end: b.endTime, bufferMinutes: 10, gameCopies: 1, ...o });

  it('lists the other tables that overlap it, buffer included', () => {
    expect(find()).toEqual([a]);
    expect(find({ start: '15:35', end: '16:30' })).toEqual([a]);
    expect(find({ start: '15:45', end: '16:30' })).toEqual([]);
  });
  it('is empty with enough copies, for other games, and for cancelled or finished tables', () => {
    expect(find({ gameCopies: 2 })).toEqual([]);
    expect(find({ tables: [a, { ...b, gameId: 'g2' }], table: { id: 'b', gameId: 'g1' } })).toEqual([a]);
    expect(find({ tables: [{ ...a, gameId: 'g2' }, b] })).toEqual([]);
    expect(find({ tables: [{ ...a, status: 'cancelled' }, b] })).toEqual([]);
    expect(find({ tables: [{ ...a, status: 'completed' }, b] })).toEqual([]);
  });
});

// ── reviewWaitingTables ─────────────────────────────────────────────────────
describe('reviewWaitingTables — tables waiting for someone to confirm they explain them', () => {
  const waiting = (o: Partial<Table> = {}) => table('w', {
    gameId: 'g1', status: 'recommended', awaitingExplainer: true, explainerId: 'p1', candidateIds: ['p1', 'p2'],
    queuedIds: ['p3'], startTime: '12:00', endTime: '13:00', ...o,
  });
  const people = () => voters(3).map((p) => (p.id === 'p2' ? { ...p, canExplain: ['g1'] } : p));
  const busyWith = (id: string) => table('o', { gameId: 'g2', status: 'confirmed', playerIds: [id, 'p9'], startTime: '12:30', endTime: '13:30' });

  it('leaves the table alone while everyone it was offered to can still explain it', () => {
    expect(reviewWaitingTables(people(), [waiting()], 10)).toEqual([]);
  });

  it('drops from the offer someone who accepted another table at that hour, keeping the others', () => {
    expect(reviewWaitingTables(people(), [waiting(), busyWith('p1')], 10)).toEqual([
      { tableId: 'w', action: 'update', explainerId: 'p2', candidateIds: ['p2'] },
    ]);
  });

  it('cancels it right away when nobody who was asked can explain it any more', () => {
    expect(reviewWaitingTables(people(), [waiting({ candidateIds: ['p1'] }), busyWith('p1')], 10)).toEqual([{ tableId: 'w', action: 'cancel' }]);
  });

  it('reacts when someone dropped the vote, can no longer explain it, or is gone from the event', () => {
    const noVote = people().map((p) => (p.id === 'p1' ? { ...p, interests: {} } : p));
    const noExplain = people().map((p) => (p.id === 'p1' ? { ...p, canExplain: [] } : p));
    const gone = people().filter((p) => p.id !== 'p1');
    for (const ps of [noVote, noExplain, gone]) {
      expect(reviewWaitingTables(ps, [waiting()], 10)).toEqual([{ tableId: 'w', action: 'update', explainerId: 'p2', candidateIds: ['p2'] }]);
    }
  });

  it('ignores tables that are not waiting for an explainer', () => {
    const plain = table('plain', { gameId: 'g1', status: 'recommended', explainerId: 'p1', candidateIds: ['p1', 'p2'] });
    expect(reviewWaitingTables([], [plain, table('c', { status: 'confirmed', awaitingExplainer: true })], 10)).toEqual([]);
  });
});

// ── computeIdleGaps ─────────────────────────────────────────────────────────
describe('computeIdleGaps', () => {
  it('reports long stretches with nothing to play, around the tables and breaks', () => {
    const p = player('p1', { arrivalTime: '10:00', departureTime: '18:00' });
    const tables = [table('t', { playerIds: ['p1'], startTime: '11:00', endTime: '12:00', status: 'confirmed' })];
    const gaps = computeIdleGaps([p], tables, [{ start: '13:00', end: '14:00' }], 60);
    expect(gaps.map((g) => `${g.start}-${g.end}`)).toEqual(['10:00-11:00', '12:00-13:00', '14:00-18:00']);
  });
  it('skips gaps shorter than the minimum and ignores cancelled tables', () => {
    const p = player('p1', { arrivalTime: '10:00', departureTime: '12:00' });
    const tables = [table('t', { playerIds: ['p1'], startTime: '10:30', endTime: '11:30', status: 'cancelled' })];
    expect(computeIdleGaps([p], tables, [], 60)).toHaveLength(1); // one 2-hour gap, the cancelled table doesn't split it
    expect(computeIdleGaps([p], [], [], 180)).toEqual([]);
  });
});
