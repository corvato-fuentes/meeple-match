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
 * Assigns each table session to a physical table slot, packing sessions as tightly as possible
 * (reusing any free slot regardless of which game used it last) so the board doesn't spread out
 * across more physical tables than it needs to. A slot only counts as free once bufferMinutes
 * have passed since its last session ended.
 *
 * The one exception: if a game's next session starts soon after its previous one (within
 * STICKY_SLOT_WINDOW_MIN), it returns to the same slot instead of hopping around — easier for
 * players to find "the Ark Nova table". If the gap is longer than that, the slot is up for grabs
 * like any other and the returning session just gets packed in wherever fits.
 */
export function assignPhysicalSlots(
  tables: Table[],
  bufferMinutes = 0
): { assignments: SlotAssignment[]; slotCount: number } {
  const sorted = [...tables].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
  const slotFreeAt: number[] = [];
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
    } else {
      slot = slotFreeAt.findIndex((freeAt) => freeAt + bufferMinutes <= start);
      if (slot === -1) slot = slotFreeAt.length;
    }

    slotFreeAt[slot] = end;
    lastSlotByGame.set(t.gameId, slot);
    lastEndByGame.set(t.gameId, end);
    assignments.push({ slot, table: t });
  }

  return { assignments, slotCount: slotFreeAt.length };
}
