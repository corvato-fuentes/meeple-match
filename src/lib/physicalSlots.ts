import type { Table } from './types';
import { toMinutes } from './timeUtils';

export interface SlotAssignment {
  slot: number;
  table: Table;
}

interface ColumnInterval {
  start: number;
  end: number;
}

/** True if none of a game's sessions would overlap (with buffer) anything already in this column. */
function fitsColumn(occupied: ColumnInterval[], sessions: Table[], bufferMinutes: number): boolean {
  return sessions.every((s) => {
    const start = toMinutes(s.startTime);
    const end = toMinutes(s.endTime);
    return occupied.every((iv) => end + bufferMinutes <= iv.start || start >= iv.end + bufferMinutes);
  });
}

/**
 * Assigns each table session to a physical table slot, trying to keep every session of the same
 * game on a single table for the whole day rather than deciding slot-by-slot. Games are placed
 * one at a time (earliest first session first) into the first existing column where ALL of that
 * game's sessions fit without colliding with what's already there (respecting bufferMinutes
 * between different games); only if no single column works for the whole game does it fall back
 * to whatever's available. This still lets other, unrelated games slot into the gaps between a
 * game's own sessions in the same column, so table usage stays compact.
 */
export function assignPhysicalSlots(
  tables: Table[],
  bufferMinutes = 0
): { assignments: SlotAssignment[]; slotCount: number } {
  const byGame = new Map<string, Table[]>();
  for (const t of tables) {
    const arr = byGame.get(t.gameId) ?? [];
    arr.push(t);
    byGame.set(t.gameId, arr);
  }
  for (const sessions of byGame.values()) sessions.sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));

  // Earliest first session first (tableNumber as a deterministic tiebreak) — so whichever game
  // has been around longest gets first pick of a column.
  const gameGroups = [...byGame.values()].sort((a, b) => {
    const diff = toMinutes(a[0].startTime) - toMinutes(b[0].startTime);
    return diff !== 0 ? diff : a[0].tableNumber - b[0].tableNumber;
  });

  const columns: ColumnInterval[][] = [];
  const assignments: SlotAssignment[] = [];

  for (const sessions of gameGroups) {
    let slot = columns.findIndex((occupied) => fitsColumn(occupied, sessions, bufferMinutes));
    if (slot === -1) {
      columns.push([]);
      slot = columns.length - 1;
    }
    sessions.forEach((s) => {
      columns[slot].push({ start: toMinutes(s.startTime), end: toMinutes(s.endTime) });
      assignments.push({ slot, table: s });
    });
    columns[slot].sort((a, b) => a.start - b.start);
  }

  return { assignments, slotCount: columns.length };
}
