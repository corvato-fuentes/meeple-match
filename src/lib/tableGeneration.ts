import { getPlayers, getGames, getTables, saveProposedTables, fillTableSeats } from '@/lib/firestore';
import { generateTables, fillExistingTables } from '@/lib/tableAlgorithm';
import type { MeepleEvent } from '@/lib/types';

export interface TableGenerationResult {
  filledSeats: number;
  newTables: number;
}

// Shared by the admin's manual "Generar mesas" button and the auto-generate triggers
// (player registration / wishlist save) — fills open seats in existing tables first,
// then proposes new tables with whatever's left over.
export async function runTableGeneration(
  eventCode: string,
  event: MeepleEvent
): Promise<TableGenerationResult> {
  const [allPlayers, allGames, allTables] = await Promise.all([
    getPlayers(eventCode), getGames(eventCode), getTables(eventCode),
  ]);
  const fills = fillExistingTables(allPlayers, allGames, allTables);
  for (const fill of fills) await fillTableSeats(eventCode, fill.tableId, fill.playerIds);
  const currentTables = fills.length > 0 ? await getTables(eventCode) : allTables;
  const batchNumber = currentTables.length > 0
    ? Math.max(...currentTables.map((t) => t.batchNumber)) + 1
    : 1;
  const proposals = generateTables(
    allPlayers, allGames, currentTables,
    event.settings.bufferMinutes, event.settings.physicalTables, batchNumber, event.settings.breaks
  );
  await saveProposedTables(eventCode, proposals as any);
  const filledSeats = fills.reduce((n, f) => {
    const before = allTables.find((t) => t.id === f.tableId)?.playerIds.length ?? 0;
    return n + (f.playerIds.length - before);
  }, 0);
  return { filledSeats, newTables: proposals.length };
}
