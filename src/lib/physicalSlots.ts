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
 * game (or, for a merged multi-copy game, of the same physical copy) on a single table for the
 * whole day rather than deciding slot-by-slot. Groups are placed one at a time (earliest first
 * session first) into the first existing column where ALL of the group's sessions fit without
 * colliding with what's already there (respecting bufferMinutes between different games); only if
 * no single column works for the whole group does it fall back to whatever's available. This still
 * lets other, unrelated games slot into the gaps between a group's own sessions in the same
 * column, so table usage stays compact.
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

  // A merged game with multiple physical copies can have sessions running at the same time (one
  // per copy) — those can never share a column, so split each game into the fewest "tracks" of
  // mutually non-overlapping sessions first. A single-copy game's sessions are already
  // non-overlapping by construction, so this is a no-op for the common case and only kicks in
  // for real concurrent copies.
  const trackGroups = [...byGame.values()].flatMap((sessions) => {
    const tracks: Table[][] = [];
    for (const s of sessions) {
      const start = toMinutes(s.startTime);
      const track = tracks.find((t) => toMinutes(t[t.length - 1].endTime) + bufferMinutes <= start);
      if (track) track.push(s); else tracks.push([s]);
    }
    return tracks;
  });

  // Earliest first session first (tableNumber as a deterministic tiebreak) — so whichever track
  // has been around longest gets first pick of a column.
  const gameGroups = trackGroups.sort((a, b) => {
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
