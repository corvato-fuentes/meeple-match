import { describe, expect, it } from 'vitest';
import { formatMinutes, pickNextTable } from './nextTable';
import type { Table } from './types';

const table = (id: string, startTime: string, endTime: string, status: Table['status'] = 'confirmed'): Table =>
  ({ id, startTime, endTime, status }) as Table;
const tables = [table('a', '11:00', '12:00'), table('b', '14:00', '15:30'), table('c', '16:00', '17:00', 'completed'), table('d', '09:00', '09:45', 'recommended')];
const at = (date: string, h: number, m: number) => new Date(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);
const DAY = '2026-11-06';
const pick = (date: string, now: Date) => pickNextTable(tables, date, now);

describe('pickNextTable', () => {
  it('shows the next table with how long until it starts', () => {
    expect(pick(DAY, at(DAY, 8, 0))).toMatchObject({ kind: 'later', minutesUntilStart: 180, table: { id: 'a' } });
  });
  it('flags a table starting within 20 minutes as "soon"', () => {
    expect(pick(DAY, at(DAY, 10, 45))).toMatchObject({ kind: 'soon', minutesUntilStart: 15 });
  });
  it('shows the table in progress with the time left (starting now counts as live)', () => {
    expect(pick(DAY, at(DAY, 11, 0))).toMatchObject({ kind: 'live', minutesLeft: 60, table: { id: 'a' } });
    expect(pick(DAY, at(DAY, 11, 59))).toMatchObject({ kind: 'live', minutesLeft: 1 });
  });
  it('moves on to the following table once one ends', () => {
    expect(pick(DAY, at(DAY, 12, 0))).toMatchObject({ kind: 'later', minutesUntilStart: 120, table: { id: 'b' } });
  });
  it('has nothing left to show after the last confirmed table (completed / recommended ones do not count)', () => {
    expect(pick(DAY, at(DAY, 15, 30))).toBeNull();
  });
  it('shows the first table before the event day, nothing after it', () => {
    expect(pick('2026-12-31', at(DAY, 12, 0))).toMatchObject({ kind: 'future', table: { id: 'a' } });
    expect(pick('2026-10-01', at(DAY, 12, 0))).toBeNull();
  });
  it('has nothing without tables', () => {
    expect(pickNextTable([], DAY, at(DAY, 12, 0))).toBeNull();
  });
});

describe('formatMinutes', () => {
  it.each([[0, '0 min'], [25, '25 min'], [60, '1 h'], [85, '1 h 25 min'], [-5, '0 min']])('%s → %s', (n, text) => {
    expect(formatMinutes(n)).toBe(text);
  });
});
