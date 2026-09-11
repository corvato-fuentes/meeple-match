import type { Table } from './types';
import { toMinutes } from './timeUtils';

export interface SlotAssignment {
  slot: number;
  table: Table;
}

// A game only "keeps" its table across a gap between its own sessions if the next one starts
// within this long — otherwise the table sits empty too long to justify holding it reserved.
const STICKY_SLOT_WINDOW_MIN = 30;

/**
 * Assigns each table session to a physical table slot. A slot only counts as free once
 * bufferMinutes have passed since its last session ended — same table needs time to be cleared,
 * reset and re-seated between two different games.
 *
 * A table isn't "owned" by any one game, but if a game's next session starts soon after its
 * previous one (within STICKY_SLOT_WINDOW_MIN), it returns to the same slot instead of hopping
 * around — easier for players to find "the Ark Nova table". If the gap is longer than that, the
 * slot is up for grabs like any other and the returning session gets assigned fresh.
 */
export function assignPhysicalSlots(
  tables: Table[],
  bufferMinutes = 0,
  physicalTables: number | null = null
): { assignments: SlotAssignment[]; slotCount: number } {
  const sorted = [...tables].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
  const slotFreeAt: number[] = [];
  const slotLastGameId: (string | null)[] = [];
  const lastSlotByGame = new Map<string, number>();
  const lastEndByGame = new Map<string, number>();
  const assignments: SlotAssignment[] = [];

  for (const t of sorted) {
    const start = toMinutes(t.startTime);
    const end = toMinutes(t.endTime);
    const priorSlot = lastSlotByGame.get(t.gameId);
    const priorEnd = lastEndByGame.get(t.gameId);

    let slot = -1;
    if (
      priorSlot != null && priorEnd != null &&
      start - priorEnd <= STICKY_SLOT_WINDOW_MIN &&
      (slotFreeAt[priorSlot] ?? 0) + bufferMinutes <= start
    ) {
      slot = priorSlot;
    } else if (physicalTables == null || slotFreeAt.length < physicalTables) {
      // A brand-new physical table is still available — use it rather than displacing a game
      // that's merely between sessions from a slot it might come back to later.
      slot = slotFreeAt.length;
    } else {
      // No new table left to open — reuse whichever free slot is least likely to be "claimed"
      // by someone else: prefer one no game has used yet over one belonging to another game.
      const free = slotFreeAt
        .map((freeAt, i) => ({ i, freeAt }))
        .filter((s) => s.freeAt + bufferMinutes <= start)
        .map((s) => s.i);
      slot = free.find((i) => slotLastGameId[i] === null) ?? free[0] ?? slotFreeAt.length;
    }

    slotFreeAt[slot] = end;
    slotLastGameId[slot] = t.gameId;
    lastSlotByGame.set(t.gameId, slot);
    lastEndByGame.set(t.gameId, end);
    assignments.push({ slot, table: t });
  }

  return { assignments, slotCount: slotFreeAt.length };
}
