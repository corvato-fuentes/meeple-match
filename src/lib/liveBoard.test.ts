import { describe, expect, it } from 'vitest';
import { destinationsFor, fitsPlayer, freeTables, impliesPresence, peopleWithoutTable, tablesOf } from './liveBoard';

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
