import { getPlayers, getGames, getTables, saveProposedTables, deleteStaleTables, fillTableSeats } from '@/lib/firestore';
import { generateTables, fillExistingTables } from '@/lib/tableAlgorithm';
import { isAutoGenerationLocked } from '@/lib/timeUtils';
import type { MeepleEvent } from '@/lib/types';

export interface TableGenerationResult {
  filledSeats: number;
  newTables: number;
}

/**
 * Shared by the admin's manual "Generar mesas" button and the auto-generate triggers (player
 * registration / wishlist save). Always does a full regeneration: any table that isn't
 * "confirmed" (proposed, cancelled, in-progress or completed) is discarded and rebuilt from the
 * latest votes, since a player may have registered or changed their mind since it was created.
 * Only confirmed tables are ever left untouched — that's the admin's explicit lock.
 *
 * Once inside the configured freeze window before the event (by default, midnight of the event
 * day), auto-triggers (manual=false) stop regenerating altogether so the grid freezes into
 * something stable; the admin can still force a rebuild.
 */
export async function runTableGeneration(
  eventCode: string,
  event: MeepleEvent,
  opts: { manual?: boolean } = {}
): Promise<TableGenerationResult> {
  if (!opts.manual && isAutoGenerationLocked(event.date, event.settings.autoGenerateFreezeHours)) {
    return { filledSeats: 0, newTables: 0 };
  }

  const [allPlayers, allGames, allTables] = await Promise.all([
    getPlayers(eventCode), getGames(eventCode), getTables(eventCode),
  ]);
  const stale = allTables.filter((t) => t.status !== 'confirmed');
  // Re-checked per-table inside a transaction — if one of these got confirmed by the admin at
  // this exact moment, it's kept instead of being wiped out from under them.
  const keptConfirmed = stale.length > 0 ? await deleteStaleTables(eventCode, stale.map((t) => t.id)) : [];
  const lockedTables = [
    ...allTables.filter((t) => t.status === 'confirmed'),
    ...stale.filter((t) => keptConfirmed.includes(t.id)),
  ];

  const fills = fillExistingTables(allPlayers, allGames, lockedTables, event.settings.bufferMinutes);
  for (const fill of fills) await fillTableSeats(eventCode, fill.tableId, fill.playerIds);
  const currentTables = fills.length > 0 ? await getTables(eventCode) : lockedTables;
  const batchNumber = currentTables.length > 0
    ? Math.max(...currentTables.map((t) => t.batchNumber)) + 1
    : 1;
  const proposals = generateTables(
    allPlayers, allGames, currentTables,
    event.settings.bufferMinutes, event.settings.physicalTables, batchNumber, event.settings.breaks
  );
  await saveProposedTables(eventCode, proposals as any);
  const filledSeats = fills.reduce((n, f) => {
    const before = lockedTables.find((t) => t.id === f.tableId)?.playerIds.length ?? 0;
    return n + (f.playerIds.length - before);
  }, 0);
  return { filledSeats, newTables: proposals.length };
}
