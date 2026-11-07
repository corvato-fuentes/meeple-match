import {
  getPlayers, getGames, getTables, saveProposedTables, updateTableCandidates, fillTableSeats,
  acquireGenerationLock, releaseGenerationLock, deleteStaleTables, applyWaitingTableReviews,
} from '@/lib/firestore';
import { generateTables, fillExistingTables, reviewWaitingTables } from '@/lib/tableAlgorithm';
import { isEventOver, toMinutes, toTimeString } from '@/lib/timeUtils';
import { requestPushSync } from '@/lib/pushClient';
import type { MeepleEvent, Player, Table } from '@/lib/types';

/** True when the table's time slot isn't fully inside the event's current schedule. */
export function isOutsideEventWindow(t: Table, startTime: string, endTime: string): boolean {
  return toMinutes(t.startTime) < toMinutes(startTime) || toMinutes(t.endTime) > toMinutes(endTime);
}

/**
 * A player's availability trimmed to the event's schedule, or null if they don't overlap it at all.
 * Players saved under an older schedule can still carry times outside the current window; without
 * this the algorithm would happily propose tables in hours the event no longer covers.
 */
function withinEventWindow(p: Player, startTime: string, endTime: string): Player | null {
  const arrival = Math.max(toMinutes(p.arrivalTime), toMinutes(startTime));
  const departure = Math.min(toMinutes(p.departureTime), toMinutes(endTime));
  if (arrival >= departure) return null;
  return { ...p, arrivalTime: toTimeString(arrival), departureTime: toTimeString(departure) };
}

/**
 * Right after the admin changes the event's schedule: removes unconfirmed algorithm-recommended
 * tables that no longer fit it, and reports how many confirmed / owner-posted tables now fall
 * outside (those are left alone for the admin to review).
 */
export async function pruneOutOfWindowTables(
  eventCode: string, startTime: string, endTime: string
): Promise<{ removed: number; flagged: number }> {
  const outside = (await getTables(eventCode)).filter(
    (t) => t.status !== 'cancelled' && isOutsideEventWindow(t, startTime, endTime)
  );
  const stale = outside.filter((t) => t.status === 'recommended' && !t.postedByOwner);
  const keptConfirmed = stale.length > 0 ? await deleteStaleTables(eventCode, stale.map((t) => t.id)) : [];
  const removed = stale.length - keptConfirmed.length;
  return { removed, flagged: outside.length - removed };
}

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
    const [rawPlayers, allGames, allTables] = await Promise.all([
      getPlayers(eventCode), getGames(eventCode), getTables(eventCode),
    ]);
    // An algorithm-recommended table nobody has confirmed that no longer fits the event's schedule
    // (e.g. the admin shortened the day after it was proposed) is just stale demand — drop it so the
    // pass below can propose a fresh one inside the window. Confirmed and owner-posted tables are
    // never touched here; the admin sees those flagged instead.
    const allPlayers = rawPlayers
      .map((p) => withinEventWindow(p, event.startTime, event.endTime))
      .filter((p): p is Player => p !== null);
    const stale = allTables.filter(
      (t) => t.status === 'recommended' && !t.postedByOwner && isOutsideEventWindow(t, event.startTime, event.endTime)
    );
    const keptConfirmed = stale.length > 0 ? await deleteStaleTables(eventCode, stale.map((t) => t.id)) : [];
    const removedIds = new Set(stale.map((t) => t.id).filter((id) => !keptConfirmed.includes(id)));
    let activeTables = allTables.filter((t) => t.status !== 'cancelled' && !removedIds.has(t.id));

    // A table still waiting for its explainer to confirm: if that person can no longer do it (accepted another table at
    // that time, left, dropped the vote…) it goes to the next one who can explain it, or is cancelled right away.
    const reviews = reviewWaitingTables(allPlayers, activeTables, event.settings.bufferMinutes);
    if (reviews.length > 0) {
      await applyWaitingTableReviews(eventCode, reviews);
      const cancelled = new Set(reviews.filter((r) => r.action === 'cancel').map((r) => r.tableId));
      activeTables = (await getTables(eventCode)).filter((t) => t.status !== 'cancelled' && !removedIds.has(t.id) && !cancelled.has(t.id));
    }

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
    for (const update of candidateUpdates) await updateTableCandidates(eventCode, update.tableId, update);
    // New offers / seats just got written: let the server send the matching push notifications
    if (proposals.length > 0 || candidateUpdates.length > 0 || fills.length > 0 || reviews.length > 0) requestPushSync(eventCode);

    const filledSeats = fills.reduce((n, f) => {
      const before = activeTables.find((t) => t.id === f.tableId)?.playerIds.length ?? 0;
      return n + (f.playerIds.length - before);
    }, 0);
    return { filledSeats, newTables: proposals.length };
  } finally {
    await releaseGenerationLock(eventCode);
  }
}
