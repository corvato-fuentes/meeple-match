import { describe, expect, it } from 'vitest';
import { attentionCount, chipCounts, chipsFor, clashesOf, durationLine, explainerLine, exploreRows, rowsFor, seatsLine } from './exploreTables';

const game = (id: string, maxPlayers = 4, minPlayers = 2) => ({ id, name: id.toUpperCase(), maxPlayers, minPlayers }) as never;
const viewer = (extra: Record<string, unknown> = {}) =>
  ({ id: 'me', name: 'Yo', arrivalTime: '10:00', departureTime: '20:00', interests: {}, repeatGameIds: [], ...extra }) as never;
const table = (id: string, gameId: string, start: string, end: string, playerIds: string[], extra: Record<string, unknown> = {}) =>
  ({ id, gameId, gameName: gameId.toUpperCase(), startTime: start, endTime: end, playerIds, status: 'recommended', explainerId: playerIds[0] ?? 'x', ...extra }) as never;

const games = [game('dixit', 6), game('azul', 4), game('brass', 4, 3)];
const never = () => false;
const rows = (tables: unknown[], v = viewer()) => exploreRows({ viewer: v, tables: tables as never, games, bufferMinutes: 15, started: never });
const byId = (r: ReturnType<typeof rows>, id: string) => r.find((x) => x.table.id === id)!;

describe('exploreRows: the life of a table', () => {
  it('places each state on its step and words it', () => {
    const r = rows([
      table('rec', 'azul', '12:00', '13:00', ['a'], { candidateIds: ['me'] }),
      table('conf', 'azul', '14:00', '15:00', ['a', 'b'], { status: 'confirmed' }),
      table('play', 'dixit', '10:00', '11:00', ['a', 'b'], { status: 'in-progress' }),
      table('done', 'dixit', '08:00', '09:00', ['a', 'b'], { status: 'completed' }),
      table('gone', 'dixit', '16:00', '17:00', ['a'], { status: 'cancelled' }),
    ]);
    expect(r.map((x) => x.table.id)).not.toContain('gone');
    expect(r.map((x) => [x.table.id, x.step, x.label])).toEqual([
      ['done', 'done', 'Terminó'], ['play', 'playing', 'Jugando'], ['rec', 'forming', 'Te la proponemos'], ['conf', 'confirmed', 'Confirmada'],
    ]); // listed by hour: 08:00, 10:00, 12:00, 14:00
  });

  it('words a posted table, one the person is in, and one waiting for its explainer', () => {
    const r = rows([
      table('posted', 'azul', '12:00', '13:00', ['a'], { postedByOwner: true }),
      table('mine', 'azul', '14:00', '15:00', ['me', 'a']),
      table('exp', 'dixit', '16:00', '17:00', [], { awaitingExplainer: true, candidateIds: ['z'] }),
      table('plain', 'brass', '17:30', '19:00', ['a']),
    ]);
    expect(byId(r, 'posted').label).toBe('Abierta');
    expect(byId(r, 'mine').label).toBe('Anotado · falta gente');
    expect(byId(r, 'exp').label).toBe('Esperando quien la explique');
    expect(byId(r, 'plain').label).toBe('Esperando gente');
  });
});

describe('exploreRows: a game voted "no me interesa"', () => {
  const v = viewer({ interests: { azul: 'no', dixit: 'yes' } });
  const tables = [
    table('no-rec', 'azul', '12:00', '13:00', ['a'], { candidateIds: ['me'] }),
    table('no-posted', 'azul', '13:00', '14:00', ['a'], { postedByOwner: true }),
    table('no-conf', 'azul', '14:00', '15:00', ['a', 'b'], { status: 'confirmed' }),
    table('no-play', 'azul', '10:00', '11:00', ['a', 'b'], { status: 'in-progress' }),
    table('no-done', 'azul', '08:00', '09:00', ['a', 'b'], { status: 'completed' }),
    table('no-rejected', 'azul', '16:00', '17:00', ['a'], { rejectedIds: ['me'] }),
    table('yes', 'dixit', '12:00', '13:00', ['a']),
    table('unvoted', 'brass', '15:30', '17:30', ['a']),
  ];
  it('is not shown in any filter: not as an offer, not open, not confirmed, not underway, not finished, not rejected', () => {
    const r = rows(tables, v);
    expect(r.map((x) => x.table.id).sort()).toEqual(['unvoted', 'yes']);
    const counts = chipCounts(r);
    expect(counts['for-you']).toBe(0);
    expect(counts.rejected).toBe(0);
    expect(counts.done).toBe(0);
    expect(counts.all).toBe(2);
  });
  it('a game they voted yes, or never voted, still shows', () => {
    const r = rows(tables, v);
    expect(r.map((x) => x.table.id)).toContain('yes');
    expect(r.map((x) => x.table.id)).toContain('unvoted');
  });
  it('a table they are in is never hidden, whatever they voted', () => {
    const r = rows([table('mine', 'azul', '14:00', '15:00', ['me', 'a'], { status: 'confirmed' })], v);
    expect(r.map((x) => x.table.id)).toEqual(['mine']);
    expect(r[0].mine).toBe(true);
  });
});

describe('exploreRows: what is for you', () => {
  it('an offer that waits for your answer is for you, and so is an open posted table of a game you voted that fits', () => {
    const v = viewer({ interests: { dixit: 'yes' } });
    const r = rows([
      table('offer', 'azul', '12:00', '13:00', ['a'], { candidateIds: ['me'] }),
      table('open', 'dixit', '14:00', '15:00', ['a'], { postedByOwner: true }),
      table('other', 'azul', '16:00', '17:00', ['a'], { candidateIds: ['z'] }),
    ], v);
    expect(rowsFor(r, 'for-you').map((x) => x.table.id)).toEqual(['offer', 'open']);
    expect(attentionCount(r)).toBe(2);
  });

  it('a posted table that does not fit your hours, or of a game you did not vote, is not for you', () => {
    const v = viewer({ interests: { dixit: 'yes' }, arrivalTime: '13:00' });
    const r = rows([
      table('early', 'dixit', '11:00', '12:00', ['a'], { postedByOwner: true }),
      table('novote', 'azul', '14:00', '15:00', ['a'], { postedByOwner: true }),
    ], v);
    expect(attentionCount(r)).toBe(0);
  });

  it('a posted table that clashes with a set table of yours is not for you; with one still waiting it is', () => {
    const v = viewer({ interests: { dixit: 'yes' } });
    const withSet = rows([table('mine', 'azul', '14:00', '15:00', ['me', 'a'], { status: 'confirmed' }), table('p', 'dixit', '14:30', '15:30', ['a'], { postedByOwner: true })], v);
    expect(byId(withSet, 'p').openForYou).toBe(false);
    const withWaiting = rows([table('mine', 'azul', '14:00', '15:00', ['me', 'a']), table('p', 'dixit', '14:30', '15:30', ['a'], { postedByOwner: true })], v);
    expect(byId(withWaiting, 'p').openForYou).toBe(true);
  });

  it('nothing is for an undecided person', () => {
    const v = viewer({ registrationStatus: 'tentative', interests: { dixit: 'yes' } });
    const r = rows([table('offer', 'azul', '12:00', '13:00', ['a'], { candidateIds: ['me'] }), table('open', 'dixit', '14:00', '15:00', ['a'], { postedByOwner: true })], v);
    expect(attentionCount(r)).toBe(0);
  });
});

describe('exploreRows: the filters', () => {
  const tables = [
    table('rec', 'azul', '12:00', '13:00', ['a'], { candidateIds: ['me'] }),
    table('posted', 'dixit', '12:30', '13:30', ['a'], { postedByOwner: true }),
    table('mine', 'azul', '14:00', '15:00', ['me', 'a', 'b', 'c'], { status: 'confirmed' }),
    table('confOpen', 'dixit', '15:30', '16:30', ['a', 'b'], { status: 'confirmed' }),
    table('play', 'dixit', '10:00', '11:00', ['a', 'b'], { status: 'in-progress' }),
    table('done', 'dixit', '08:00', '09:00', ['a', 'b'], { status: 'completed' }),
    table('no', 'azul', '17:00', '18:00', ['a'], { rejectedIds: ['me'] }),
  ];
  const r = rows(tables);

  it('counts every filter, and none is ever missing', () => {
    expect(chipCounts(r)).toEqual({
      'for-you': 1, all: 5, mine: 1, recommended: 1, posted: 1, confirmed: 2, playing: 1, free: 3, rejected: 1, done: 1,
    });
  });
  it('keeps the rejected and the finished apart from "Todas", but still there under their own filter', () => {
    expect(rowsFor(r, 'all').map((x) => x.table.id)).not.toContain('no');
    expect(rowsFor(r, 'all').map((x) => x.table.id)).not.toContain('done');
    expect(rowsFor(r, 'rejected').map((x) => x.table.id)).toEqual(['no']);
    expect(rowsFor(r, 'done').map((x) => x.table.id)).toEqual(['done']);
  });
  it('lists tables by their hour', () => {
    expect(rowsFor(r, 'all').map((x) => x.table.id)).toEqual(['play', 'rec', 'posted', 'mine', 'confOpen']);
  });
  it('a table whose hour has come takes no more people', () => {
    const started = exploreRows({ viewer: viewer(), tables: tables as never, games, bufferMinutes: 15, started: (t) => t.id === 'confOpen' });
    expect(started.find((x) => x.table.id === 'confOpen')!.chips.has('free')).toBe(false);
  });
});

describe('seatsLine', () => {
  it('says how full a table is, in each step', () => {
    const r = rows([
      table('forming', 'brass', '12:00', '14:00', ['a']),
      table('ready', 'azul', '12:00', '13:00', ['a', 'b']),
      table('conf', 'azul', '14:00', '15:00', ['a', 'b', 'c'], { status: 'confirmed' }),
      table('conf2', 'azul', '14:00', '15:00', ['a', 'b'], { status: 'confirmed' }),
      table('full', 'azul', '15:00', '16:00', ['a', 'b', 'c', 'd'], { status: 'confirmed' }),
      table('play', 'dixit', '10:00', '11:00', ['a', 'b'], { status: 'in-progress' }),
      table('done', 'dixit', '08:00', '09:00', ['a', 'b'], { status: 'completed' }),
      table('exp', 'dixit', '16:00', '17:00', [], { awaitingExplainer: true }),
    ]);
    const line = (id: string) => seatsLine(byId(r, id));
    expect(line('forming')).toBe('1 de 4 · faltan 2 para confirmar');
    expect(line('ready')).toBe('2 de 4 · ya tiene el mínimo');
    expect(line('conf')).toBe('3 de 4 · queda 1 lugar');
    expect(line('conf2')).toBe('2 de 4 · quedan 2 lugares');
    expect(line('full')).toBe('4 de 4 · completa');
    expect(line('play')).toBe('2 de 6 jugando');
    expect(line('done')).toBe('Jugaron 2');
    expect(line('exp')).toBe('0 de 6');
  });
});

describe('explainerLine', () => {
  const names: Record<string, string> = { ana: 'Ana', me: 'Vos' };
  const nameOf = (id: string) => names[id] ?? 'alguien';
  it('says who explains, you included, and when nobody does yet', () => {
    expect(explainerLine({ explainerId: 'ana' }, nameOf, 'me')).toBe('explica Ana');
    expect(explainerLine({ explainerId: 'me' }, nameOf, 'me')).toBe('la explicás vos');
    expect(explainerLine({ awaitingExplainer: true, explainerId: 'ana' }, nameOf, 'me')).toBe('busca quien la explique');
    expect(explainerLine({ explainerId: '' }, nameOf, 'me')).toBeNull();
  });
  it('says so when the explainer only explains', () => {
    expect(explainerLine({ explainerId: 'ana', explainerPlays: false }, nameOf, 'me')).toBe('Ana la explica y no juega');
    expect(explainerLine({ explainerId: 'me', explainerPlays: false }, nameOf, 'me')).toBe('la explicás vos y no jugás');
  });
});

describe('durationLine', () => {
  const game = { id: 'g', minPlayers: 2, maxPlayers: 4, durationMinutes: 0, setupMinutes: 10, explanationMinutes: 10, perPlayerMinutes: 20 } as never;
  it('with room left, shows the time with the people it has now, and what the table reserves', () => {
    expect(durationLine({ startTime: '12:00', endTime: '14:00', playerIds: ['a', 'b'] }, game)).toBe('~60 min con 2 jugadores (hasta las 13:00) · la mesa reserva hasta las 14:00');
  });
  it('never counts fewer people than the game needs', () => {
    expect(durationLine({ startTime: '12:00', endTime: '14:00', playerIds: ['a'] }, game)).toBe('~60 min con 2 jugadores (hasta las 13:00) · la mesa reserva hasta las 14:00');
  });
  it('once every seat is taken, shows the full time', () => {
    expect(durationLine({ startTime: '12:00', endTime: '14:00', playerIds: ['a', 'b', 'c', 'd'] }, game)).toBe('~100 min (hasta las 14:00)');
  });
  it('says nothing for an unknown game', () => {
    expect(durationLine({ startTime: '12:00', endTime: '14:00', playerIds: [] }, undefined)).toBeNull();
  });
});

describe('chipsFor', () => {
  it('leaves out "En curso" and "Terminadas" until the day of the event', () => {
    const before = chipsFor(false).map((c) => c.key);
    expect(before).not.toContain('playing');
    expect(before).not.toContain('done');
    expect(before).toEqual(['for-you', 'all', 'mine', 'recommended', 'posted', 'confirmed', 'free', 'rejected']);
  });
  it('shows every filter from the day of the event on, in the same order', () => {
    expect(chipsFor(true).map((c) => c.key)).toEqual(['for-you', 'all', 'mine', 'recommended', 'posted', 'confirmed', 'playing', 'free', 'rejected', 'done']);
  });
});

describe('clashesOf', () => {
  const me = { id: 'me' };
  it('lists the live tables of the person that the table gets in the way of, buffer included', () => {
    const tables = [
      table('mine1', 'azul', '14:00', '15:00', ['me', 'a'], { status: 'confirmed' }),
      table('mine2', 'dixit', '15:20', '16:00', ['me', 'a']),
      table('other', 'azul', '14:00', '15:00', ['a', 'b'], { status: 'confirmed' }),
      table('target', 'brass', '14:30', '15:10', ['a']),
    ];
    const target = tables[3];
    expect(clashesOf(target, me, tables, 15).map((x) => x.id)).toEqual(['mine1', 'mine2']);
    expect(clashesOf(target, me, tables, 0).map((x) => x.id)).toEqual(['mine1']);
  });
  it('ignores the finished and cancelled ones, and the table itself', () => {
    const tables = [
      table('done', 'azul', '14:00', '15:00', ['me'], { status: 'completed' }),
      table('gone', 'azul', '14:00', '15:00', ['me'], { status: 'cancelled' }),
      table('target', 'brass', '14:00', '15:00', ['me']),
    ];
    expect(clashesOf(tables[2], me, tables, 15)).toEqual([]);
  });
});
