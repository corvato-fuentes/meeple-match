import {
  getPlayers, getGames, getTables, saveProposedTables, updateTableCandidates, fillTableSeats,
  acquireGenerationLock, releaseGenerationLock,
} from '@/lib/firestore';
import { generateTables, fillExistingTables } from '@/lib/tableAlgorithm';
import { isEventOver } from '@/lib/timeUtils';
import type { MeepleEvent } from '@/lib/types';

export interface TableGenerationResult {
  filledSeats: number;
  newTables: number;
}

async function acquireLockWithRetry(eventCode: string): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (await acquireGenerationLock(eventCode)) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

/**
 * Shared by the admin's manual "Generar mesas" button and the auto-generate triggers (player
 * registration / wishlist save). Unlike the old must/casual algorithm, nothing gets wiped and
 * rebuilt from scratch anymore: a 'recommended' table already has candidates responding to it
 * (accepting/rejecting), so this only ever ADDS to what exists — new candidates on already-open
 * recommended tables, or brand-new recommended tables for demand nothing existing covers yet.
 * Only 'cancelled' tables are ignored; everything else (recommended, confirmed, in-progress,
 * completed) stays untouched as context.
 *
 * Once the event's scheduled end time has passed, auto-triggers (manual=false) stop regenerating
 * — there's no reason to keep reshuffling recommendations for an event that's already over. The
 * admin's manual button still works regardless, in case something needs patching after the fact.
 */
export async function runTableGeneration(
  eventCode: string,
  event: MeepleEvent,
  opts: { manual?: boolean } = {}
): Promise<TableGenerationResult> {
  if (!opts.manual && isEventOver(event.date, event.endTime)) {
    return { filledSeats: 0, newTables: 0 };
  }

  // Two regenerations running at once (e.g. two players voting seconds apart) would each build a
  // full schedule without seeing the other's writes, producing duplicate/overlapping tables. If
  // another run is already in flight, this one backs off — the next vote/registration triggers
  // another pass anyway, so nothing is permanently lost, just deferred a few seconds.
  if (!(await acquireLockWithRetry(eventCode))) {
    return { filledSeats: 0, newTables: 0 };
  }

  try {
    const [allPlayers, allGames, allTables] = await Promise.all([
      getPlayers(eventCode), getGames(eventCode), getTables(eventCode),
    ]);
    const activeTables = allTables.filter((t) => t.status !== 'cancelled');

    // Late "yes" voters can join an already-confirmed table's open seats directly, no accept needed.
    const fills = fillExistingTables(allPlayers, allGames, activeTables, event.settings.bufferMinutes);
    for (const fill of fills) await fillTableSeats(eventCode, fill.tableId, fill.playerIds);
    const currentTables = fills.length > 0 ? (await getTables(eventCode)).filter((t) => t.status !== 'cancelled') : activeTables;

    const batchNumber = currentTables.length > 0
      ? Math.max(...currentTables.map((t) => t.batchNumber)) + 1
      : 1;
    const { proposals, candidateUpdates } = generateTables(
      allPlayers, allGames, currentTables,
      event.settings.bufferMinutes, event.settings.physicalTables, batchNumber, event.settings.breaks
    );
    if (proposals.length > 0) await saveProposedTables(eventCode, proposals);
    for (const update of candidateUpdates) await updateTableCandidates(eventCode, update.tableId, update.candidateIds);

    const filledSeats = fills.reduce((n, f) => {
      const before = activeTables.find((t) => t.id === f.tableId)?.playerIds.length ?? 0;
      return n + (f.playerIds.length - before);
    }, 0);
    return { filledSeats, newTables: proposals.length };
  } finally {
    await releaseGenerationLock(eventCode);
  }
}
