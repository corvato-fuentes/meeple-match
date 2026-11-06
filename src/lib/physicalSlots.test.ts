import { describe, expect, it } from 'vitest';
import { assignPhysicalSlots, slotMapFor } from './physicalSlots';
import type { Table } from './types';

let n = 0;
const t = (gameId: string, startTime: string, endTime: string): Table =>
  ({ id: `t${++n}`, tableNumber: n, gameId, startTime, endTime }) as Table;

const slotOf = (tables: Table[], buffer = 0) => {
  const map = slotMapFor(tables, buffer);
  return tables.map((x) => map.get(x.id));
};

describe('assignPhysicalSlots', () => {
  it('uses no tables when there are no sessions', () => {
    expect(assignPhysicalSlots([])).toEqual({ assignments: [], slotCount: 0 });
  });

  it('puts simultaneous games on different physical tables', () => {
    const tables = [t('a', '10:00', '11:00'), t('b', '10:30', '11:30'), t('c', '10:45', '12:00')];
    expect(assignPhysicalSlots(tables).slotCount).toBe(3);
    expect(new Set(slotOf(tables)).size).toBe(3);
  });

  it('reuses a table once the previous game is over', () => {
    const tables = [t('a', '10:00', '11:00'), t('b', '11:00', '12:00')];
    expect(assignPhysicalSlots(tables).slotCount).toBe(1);
  });

  it('keeps the buffer between different games on the same table', () => {
    const tables = [t('a', '10:00', '11:00'), t('b', '11:05', '12:00')];
    expect(assignPhysicalSlots(tables, 10).slotCount).toBe(2); // 5 min apart < 10 min buffer
    expect(assignPhysicalSlots(tables, 5).slotCount).toBe(1);
  });

  it('keeps every session of the same game on the same table all day', () => {
    // b fits in the gap on table 1, but a's sessions stay together
    const tables = [t('a', '10:00', '11:00'), t('b', '10:00', '11:00'), t('a', '13:00', '14:00')];
    const [a1, b, a2] = slotOf(tables);
    expect(a1).toBe(a2);
    expect(b).not.toBe(a1);
  });

  it('lets unrelated games fill the gaps between a game\'s own sessions', () => {
    const tables = [t('a', '10:00', '11:00'), t('a', '14:00', '15:00'), t('b', '12:00', '13:00')];
    expect(assignPhysicalSlots(tables).slotCount).toBe(1);
  });

  it('splits concurrent copies of one game onto separate tables', () => {
    const tables = [t('catan', '10:00', '11:00'), t('catan', '10:00', '11:00')];
    const [x, y] = slotOf(tables);
    expect(x).not.toBe(y);
  });

  it('assigns every session exactly once, starting slots at 1 in slotMapFor', () => {
    const tables = [t('a', '10:00', '11:00'), t('b', '10:00', '11:00'), t('c', '12:00', '13:00')];
    const { assignments } = assignPhysicalSlots(tables);
    expect(assignments).toHaveLength(3);
    const map = slotMapFor(tables);
    expect(map.size).toBe(3);
    expect(Math.min(...map.values())).toBe(1);
  });

  it('never double-books a table', () => {
    const tables = [
      t('a', '10:00', '12:00'), t('b', '10:30', '11:30'), t('c', '11:00', '13:00'),
      t('d', '12:00', '13:00'), t('e', '12:30', '14:00'), t('a', '14:00', '15:00'),
    ];
    const { assignments } = assignPhysicalSlots(tables, 10);
    const min = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
    for (const x of assignments) {
      for (const y of assignments) {
        if (x === y || x.slot !== y.slot) continue;
        const apart = min(x.table.endTime) + 10 <= min(y.table.startTime) || min(y.table.endTime) + 10 <= min(x.table.startTime);
        expect(apart).toBe(true);
      }
    }
  });
});
