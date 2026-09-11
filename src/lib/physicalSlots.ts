import type { Table } from './types';
import { toMinutes } from './timeUtils';

export interface SlotAssignment {
  slot: number;
  table: Table;
}

/** Greedy interval scheduling: assigns each table session to the first free physical table slot.
 * A slot only counts as free once bufferMinutes have passed since its last session ended — same
 * table needs time to be cleared, reset and re-seated between two different games. */
export function assignPhysicalSlots(tables: Table[], bufferMinutes = 0): { assignments: SlotAssignment[]; slotCount: number } {
  const sorted = [...tables].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
  const slotFreeAt: number[] = [];
  const assignments: SlotAssignment[] = [];
  for (const t of sorted) {
    const start = toMinutes(t.startTime);
    const end = toMinutes(t.endTime);
    let slot = slotFreeAt.findIndex((freeAt) => freeAt + bufferMinutes <= start);
    if (slot === -1) {
      slot = slotFreeAt.length;
      slotFreeAt.push(end);
    } else {
      slotFreeAt[slot] = end;
    }
    assignments.push({ slot, table: t });
  }
  return { assignments, slotCount: slotFreeAt.length };
}
