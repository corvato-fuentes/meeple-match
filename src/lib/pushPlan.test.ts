import { describe, expect, it } from 'vitest';
import { composePayloads, planPushes, pushKey, REMINDER_MINUTES } from './pushPlan';
import type { Table } from './types';

const table = (o: Partial<Table>): Table =>
  ({ id: 't', gameName: 'Catan', startTime: '12:00', endTime: '13:30', explainerId: 'x', playerIds: [], candidateIds: [], rejectedIds: [], status: 'recommended', ...o }) as Table;

const DAY = '2026-11-06';
const plan = (tables: Table[], playerIds: string[], { today = DAY, now = 600, date = DAY } = {}) =>
  planPushes({ tables, playerIds, eventDate: date, today, nowMinutes: now });
const kinds = (p: ReturnType<typeof plan>) => p.map((x) => `${x.kind}:${x.playerId}`).sort();

describe('planPushes — what is due', () => {
  it('offers a recommended table only to players who still have to answer', () => {
    const t = table({ id: 'a', candidateIds: ['p1', 'p2'], playerIds: ['p2'] });
    expect(kinds(plan([t], ['p1', 'p2', 'p3']))).toEqual(['offer:p1']);
  });
  it('never offers again a table the player rejected, nor owner-posted ones', () => {
    expect(plan([table({ candidateIds: ['p1'], rejectedIds: ['p1'] })], ['p1'])).toHaveLength(0);
    expect(plan([table({ postedByOwner: true, candidateIds: ['p1'] })], ['p1'])).toHaveLength(0);
  });
  it('tells seated players and the explainer when a table is confirmed', () => {
    const t = table({ status: 'confirmed', playerIds: ['p1', 'p2'], explainerId: 'p3', startTime: '16:00', endTime: '17:00' });
    expect(kinds(plan([t], ['p1', 'p2', 'p3', 'p4']))).toEqual(['confirmed:p1', 'confirmed:p2', 'confirmed:p3']);
  });
  it('reminds only inside the reminder window on the event day (15 min)', () => {
    const at = (start: string) => table({ status: 'confirmed', playerIds: ['p1'], startTime: start, endTime: '11:00' });
    const hasReminder = (start: string, opts = {}) => plan([at(start)], ['p1'], opts).some((x) => x.kind === 'reminder');
    expect(REMINDER_MINUTES).toBe(15);
    expect(hasReminder('10:10')).toBe(true);
    expect(hasReminder('10:15')).toBe(true);           // exactly 15 minutes
    expect(hasReminder('10:16')).toBe(false);          // 16 minutes: too early
    expect(hasReminder('10:00', { now: 601 })).toBe(false); // already started
    expect(hasReminder('10:10', { today: '2026-11-05' })).toBe(false); // not the event day yet
  });
});

describe('planPushes — what is skipped', () => {
  it('ignores tables that ended and cancelled / completed ones', () => {
    expect(plan([table({ status: 'confirmed', playerIds: ['p1'], startTime: '08:00', endTime: '09:00' })], ['p1'], { now: 600 })).toHaveLength(0);
    expect(plan([table({ candidateIds: ['p1'], startTime: '08:00', endTime: '09:00' })], ['p1'], { now: 600 })).toHaveLength(0);
    expect(plan([table({ status: 'cancelled', playerIds: ['p1'] }), table({ status: 'completed', playerIds: ['p1'] })], ['p1'])).toHaveLength(0);
  });
  it('sends nothing once the event day is over', () => {
    expect(plan([table({ status: 'confirmed', playerIds: ['p1'] })], ['p1'], { today: '2026-11-07' })).toHaveLength(0);
  });
  it('still sends offers and confirmations in the days before the event', () => {
    const tables = [table({ id: 'o', candidateIds: ['p1'] }), table({ id: 'k', status: 'confirmed', playerIds: ['p1'] })];
    expect(kinds(plan(tables, ['p1'], { today: '2026-11-01' }))).toEqual(['confirmed:p1', 'offer:p1']);
  });
  it('gives each (kind, table, player) its own stable key', () => {
    const p = plan([table({ id: 'k', status: 'confirmed', playerIds: ['p1'], startTime: '10:10', endTime: '11:00' })], ['p1']);
    expect(new Set(p.map((x) => x.key)).size).toBe(p.length);
    expect(p.map((x) => x.key).sort()).toEqual([pushKey('confirmed', 'k', 'p1'), pushKey('reminder', 'k', 'p1')].sort());
  });
});

describe('composePayloads — what each message says', () => {
  const ctx = { code: 'ABC123', ticketCode: 'TK1 ?', slotByTableId: new Map([['c1', 3]]), nowMinutes: 600 };

  it('a single offer names the table and opens the recommended page with the ticket in the link', () => {
    const [m] = composePayloads(plan([table({ id: 'o1', candidateIds: ['p1'], startTime: '14:00', endTime: '15:00' })], ['p1']), ctx);
    expect(m.payload.title).toBe('🟡 Te ofrecen una mesa');
    expect(m.payload.body).toContain('Catan · 14:00–15:00');
    expect(m.payload.url).toBe('/event/ABC123/recommended?ticket=TK1%20%3F');
    expect(m.payload.ttl).toBe(3600);
  });
  it('several offers are folded into one message', () => {
    const offers = ['A', 'B', 'C'].map((n, i) => table({ id: `o${i}`, gameName: n, candidateIds: ['p1'], startTime: `1${4 + i}:00`, endTime: `1${5 + i}:00` }));
    const out = composePayloads(plan(offers, ['p1']), ctx);
    expect(out).toHaveLength(1);
    expect(out[0].keys).toHaveLength(3);
    expect(out[0].payload.title).toContain('3 mesas');
    expect(out[0].payload.body.startsWith('A, B y 1 más')).toBe(true);
  });
  it('a confirmation shows the physical table number, and a reminder is a separate short-lived message', () => {
    const out = composePayloads(plan([table({ id: 'c1', status: 'confirmed', playerIds: ['p1'], startTime: '10:10', endTime: '11:00' })], ['p1']), ctx);
    expect(out).toHaveLength(2);
    expect(out[0].payload.body).toContain('Mesa #3');
    expect(out[1].payload.title).toBe('⏰ Tu mesa empieza en 10 min');
    expect(out[1].payload.ttl).toBe(600);
  });
});
