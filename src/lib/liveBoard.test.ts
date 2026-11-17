import { describe, expect, it } from 'vitest';
import { liveAvailability, localDateString, addMinutes, destinationsFor, fitsPlayer, freeTables, impliesPresence, liveTables, membersOf, peopleWithoutTable, tablesOf, timeChangeClashes } from './liveBoard';

const t = (id: string, gameId: string, start: string, end: string, playerIds: string[], extra: Record<string, unknown> = {}) =>
  ({ id, gameId, gameName: gameId.toUpperCase(), startTime: start, endTime: end, playerIds, status: 'confirmed', explainerId: playerIds[0] ?? 'x', ...extra }) as never;
const g = (id: string, maxPlayers: number) => ({ id, name: id.toUpperCase(), maxPlayers, minPlayers: 2 }) as never;
const p = (id: string, arrival = '10:00', departure = '20:00', interests: Record<string, string> = {}, extra: Record<string, unknown> = {}) =>
  ({ id, name: id, arrivalTime: arrival, departureTime: departure, interests, ...extra }) as never;
const min = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

describe('freeTables', () => {
  const games = [g('dixit', 6), g('azul', 4), g('catan', 4)];
  it('lists tables with a free place, the running ones first and then by start time', () => {
    const tables = [
      t('azul1', 'azul', '17:15', '18:00', ['a', 'b']),
      t('dixit1', 'dixit', '16:20', '17:30', ['a', 'b', 'c', 'd', 'e']),
      t('catan1', 'catan', '15:00', '16:00', ['a', 'b', 'c', 'd']), // full
    ];
    const rows = freeTables(tables, games, min('16:42'));
    expect(rows.map((r) => r.table.id)).toEqual(['dixit1', 'azul1']);
    expect(rows[0]).toMatchObject({ free: 1, running: true });
    expect(rows[1]).toMatchObject({ free: 2, running: false, startsInMin: 33 });
  });
  it('leaves out finished, cancelled and explainer-less tables, and the ones whose game is unknown', () => {
    const tables = [
      t('over', 'azul', '15:00', '16:00', ['a']),
      t('cancelled', 'azul', '17:00', '18:00', ['a'], { status: 'cancelled' }),
      t('done', 'azul', '17:00', '18:00', ['a'], { status: 'completed' }),
      t('waitingExplainer', 'azul', '17:00', '18:00', [], { awaitingExplainer: true, status: 'recommended' }),
      t('nogame', 'zzz', '17:00', '18:00', ['a']),
    ];
    expect(freeTables(tables, games, min('16:42'))).toEqual([]);
  });
  it('flags a table that is still waiting for its players', () => {
    const rows = freeTables([t('w', 'azul', '17:00', '18:00', ['a'], { status: 'recommended' })], games, min('16:00'));
    expect(rows[0].waiting).toBe(true);
  });
});

describe('fitsPlayer and destinationsFor', () => {
  const games = [g('dixit', 6), g('azul', 4)];
  const tables = [t('t1', 'dixit', '16:00', '17:00', ['ana']), t('t2', 'azul', '16:30', '17:30', ['bea']), t('t3', 'azul', '17:00', '18:00', ['bea'])];
  it('does not fit a table that clashes with another of theirs, nor one they are already in', () => {
    expect(fitsPlayer(tables[1], p('ana'), tables)).toBe(false); // 16:30-17:30 clashes with 16:00-17:00
    expect(fitsPlayer(tables[2], p('ana'), tables)).toBe(true); // starts when the other ends
    expect(fitsPlayer(tables[0], p('ana'), tables)).toBe(false); // already in it
  });
  it('moving ignores the table they leave', () => {
    expect(fitsPlayer(tables[1], p('ana'), tables, 't1')).toBe(true);
  });
  it('puts the ones they voted for first, and drops the ones they voted against or rejected', () => {
    const rows = freeTables(tables, games, min('15:00'));
    const sam = p('sam', '10:00', '20:00', { azul: 'no', dixit: 'yes' });
    expect(destinationsFor(sam, rows, tables).map((o) => o.table.id)).toEqual(['t1']);
    const lea = p('lea', '10:00', '20:00', { azul: 'yes' });
    expect(destinationsFor(lea, rows, tables).map((o) => o.table.id)[0]).toBe('t2');
    const rejected = [t('r', 'azul', '16:30', '17:30', ['bea'], { rejectedIds: ['lea'] })];
    expect(destinationsFor(lea, freeTables(rejected, games, min('15:00')), rejected)).toEqual([]);
  });
});

describe('destinationsFor and the time they leave', () => {
  const games = [g('dixit', 6)];
  const tables = [t('d1', 'dixit', '14:45', '17:30', ['a'])];
  it('does not offer a table that ends after they leave', () => {
    const rows = freeTables(tables, games, min('14:30'));
    expect(destinationsFor(p('sale17', '10:00', '17:00'), rows, tables)).toEqual([]);
    expect(destinationsFor(p('sale18', '10:00', '18:00'), rows, tables).map((o) => o.table.id)).toEqual(['d1']);
  });
});

describe('peopleWithoutTable', () => {
  const games = [g('dixit', 6), g('azul', 4)];
  const now = min('16:42');
  const run = (players: unknown[], tables: unknown[], present: string[] = []) =>
    peopleWithoutTable({ players: players as never, tables: tables as never, rows: freeTables(tables as never, games, now), present: new Set(present), nowMin: now });

  it('someone who is there and has no table is free now, the confirmed ones before the unconfirmed', () => {
    const r = run([p('zoe'), p('ana')], [], ['ana']);
    expect(r.now.map((x) => [x.player.id, x.presence])).toEqual([['ana', 'here'], ['zoe', 'unconfirmed']]);
  });
  it('someone due later is "próximamente", only inside the horizon', () => {
    const r = run([p('tarde', '17:00'), p('muytarde', '19:30')], []);
    expect(r.now).toEqual([]);
    expect(r.soon.map((x) => x.player.id)).toEqual(['tarde']);
    expect(r.soon[0]).toMatchObject({ presence: 'later', freeFrom: min('17:00') });
  });
  it('someone in a table that ends soon is free soon; one in a table that runs long is not listed', () => {
    const tables = [t('t1', 'dixit', '16:00', '17:10', ['ana', 'bea']), t('t2', 'azul', '16:00', '21:00', ['cami'])];
    const r = run([p('ana'), p('cami')], tables, ['ana', 'cami']);
    expect(r.now).toEqual([]);
    expect(r.soon.map((x) => x.player.id)).toEqual(['ana']);
    expect(r.soon[0].freeFrom).toBe(min('17:10'));
  });
  it('leaves out the ones who left, the undecided and gaps too short to play', () => {
    const r = run([p('se-fue', '10:00', '16:00'), p('indeciso', '10:00', '20:00', {}, { registrationStatus: 'tentative' }), p('casi', '10:00', '17:00')],
      [t('t1', 'dixit', '16:55', '19:00', ['casi', 'x'])], ['casi']);
    expect(r.now).toEqual([]);
    expect(r.soon).toEqual([]);
  });
  it('offers the tables that fit them, with their window and vote', () => {
    const tables = [t('d1', 'dixit', '16:20', '17:30', ['a', 'b']), t('a1', 'azul', '17:15', '18:15', ['a'])];
    const r = run([p('lucia', '16:38', '20:00', { dixit: 'yes' })], tables, ['lucia']);
    expect(r.now[0].options.map((o) => [o.table.id, o.votedYes])).toEqual([['d1', true], ['a1', false]]);
  });
  it('an explainer who only explains is held just for the explanation', () => {
    const tables = [t('e1', 'dixit', '16:00', '18:00', ['b'], { explainerId: 'exp', explainerPlays: false, explainEndTime: '16:30' })];
    const r = run([p('exp')], tables, ['exp']);
    expect(r.now.map((x) => x.player.id)).toEqual(['exp']);
  });
});

describe('tablesOf and impliesPresence', () => {
  it('lists the live tables someone is in, earliest first', () => {
    const tables = [t('b', 'azul', '17:00', '18:00', ['ana']), t('a', 'dixit', '16:00', '17:00', ['ana']), t('c', 'azul', '18:00', '19:00', ['ana'], { status: 'cancelled' })];
    expect(tablesOf({ id: 'ana' }, tables, min('12:00')).map((x) => x.id)).toEqual(['a', 'b']);
    // …and not the ones that are over
    expect(tablesOf({ id: 'ana' }, tables, min('17:30')).map((x) => x.id)).toEqual(['b']);
  });
  it('a running table, or one about to start, means they are there', () => {
    expect(impliesPresence({ running: true, startsInMin: 0 })).toBe(true);
    expect(impliesPresence({ running: false, startsInMin: 10 })).toBe(true);
    expect(impliesPresence({ running: false, startsInMin: 40 })).toBe(false);
  });
});

describe('liveTables (stage B)', () => {
  const now = min('16:42');
  const live = (tables: unknown[], present: string[] = []) => liveTables(tables as never, new Set(present), now);

  it('a confirmed table past its start is late, and asks for attention; one starting within the hour is upcoming', () => {
    const r = live([t('late', 'dixit', '16:30', '18:00', ['a', 'b']), t('soon', 'azul', '17:15', '18:30', ['c']), t('far', 'azul', '19:00', '20:00', ['c'])]);
    expect(r.map((x) => [x.table.id, x.kind, x.minutes, x.attention])).toEqual([['late', 'late', 12, true], ['soon', 'upcoming', 33, false]]);
  });
  it('a confirmed table whose whole time passed is "past": was it played? It asks for attention, after the late ones', () => {
    const r = live([t('old', 'dixit', '10:00', '12:00', ['a']), t('late', 'azul', '16:30', '18:00', ['b'])]);
    expect(r.map((x) => [x.table.id, x.kind, x.minutes, x.attention])).toEqual([['late', 'late', 12, true], ['old', 'past', 282, true]]);
  });
  it('an underway table is running, and overtime (attention) once past its end', () => {
    const r = live([t('ok', 'dixit', '16:00', '17:30', ['a'], { status: 'in-progress' }), t('over', 'azul', '15:00', '16:20', ['b'], { status: 'in-progress' })]);
    expect(r.map((x) => [x.table.id, x.kind, x.minutes, x.attention])).toEqual([['over', 'overtime', 22, true], ['ok', 'running', 42, false]]);
  });
  it('lists who is not confirmed as there, an explainer who only explains included', () => {
    const table = t('t', 'dixit', '16:30', '18:00', ['a', 'b'], { explainerId: 'exp', explainerPlays: false, explainEndTime: '17:00' });
    expect(membersOf(table)).toEqual(['a', 'b', 'exp']);
    expect(live([table], ['a'])[0].missingIds).toEqual(['b', 'exp']);
  });
  it('a table nobody confirmed shows only when it is about to start, and asks for attention once it should have', () => {
    const r = live([
      t('u1', 'dixit', '16:55', '18:00', ['a'], { status: 'recommended' }),
      t('u2', 'azul', '16:30', '18:00', ['a'], { status: 'recommended' }),
      t('far', 'azul', '18:00', '19:00', ['a'], { status: 'recommended' }),
      t('empty', 'azul', '16:50', '19:00', [], { status: 'recommended' }),
      t('noexp', 'azul', '16:50', '19:00', ['a'], { status: 'recommended', awaitingExplainer: true }),
      t('over', 'azul', '15:00', '16:30', ['a'], { status: 'recommended' }),
    ]);
    expect(r.map((x) => [x.table.id, x.attention])).toEqual([['u2', true], ['u1', false]]);
  });
  it('leaves out finished and cancelled tables', () => {
    expect(live([t('c', 'dixit', '16:30', '18:00', ['a'], { status: 'completed' }), t('x', 'dixit', '16:30', '18:00', ['a'], { status: 'cancelled' })])).toEqual([]);
  });
});

describe('timeChangeClashes', () => {
  const base = { bufferMinutes: 0, copies: 1 };
  it('finds the people of the table who are in another table then', () => {
    const tables = [t('t1', 'dixit', '16:00', '17:00', ['ana', 'bea']), t('t2', 'azul', '17:00', '18:00', ['ana'])];
    expect(timeChangeClashes({ ...base, table: tables[0], start: '16:00', end: '17:00', tables }).people).toEqual([]);
    const r = timeChangeClashes({ ...base, table: tables[0], start: '16:00', end: '17:15', tables });
    expect(r.people.map((x) => [x.playerId, x.table.id])).toEqual([['ana', 't2']]);
  });
  it('finds a table of the same game when there is no spare copy', () => {
    const tables = [t('t1', 'dixit', '16:00', '17:00', ['ana']), t('t2', 'dixit', '17:00', '18:00', ['bea'])];
    expect(timeChangeClashes({ ...base, table: tables[0], start: '16:00', end: '17:30', tables }).sameGame.map((x) => x.id)).toEqual(['t2']);
    expect(timeChangeClashes({ ...base, copies: 2, table: tables[0], start: '16:00', end: '17:30', tables }).sameGame).toEqual([]);
  });
});

describe('liveAvailability', () => {
  it('is inactive before the day of the event, active on it, and still reachable after', () => {
    expect(liveAvailability('2026-11-15', '2026-11-14')).toBe('before');
    expect(liveAvailability('2026-11-15', '2026-11-15')).toBe('today');
    expect(liveAvailability('2026-11-15', '2026-11-16')).toBe('after');
    expect(liveAvailability('2026-12-01', '2026-11-30')).toBe('before');
  });
  it('writes a local date as YYYY-MM-DD', () => {
    expect(localDateString(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(localDateString(new Date(2026, 10, 15, 0, 0))).toBe('2026-11-15');
  });
});

describe('addMinutes', () => {
  it('adds minutes and never passes the end of the day', () => {
    expect(addMinutes('16:50', 15)).toBe('17:05');
    expect(addMinutes('23:50', 30)).toBe('23:59');
  });
});
