import { useState } from 'react';
import { leaveTable } from '@/lib/firestore';
import { findConflictingTables } from '@/lib/tableAlgorithm';
import type { Player, Table } from '@/lib/types';

export interface ConflictPrompt {
  /** The tables the player already holds that overlap the one they are taking — one, or several when it is a long one. */
  conflicts: Table[];
  /** The table they are trying to take (named on the buttons, so it is clear which one each button affects). */
  incoming: Table;
  /**
   * soft: the other tables are still waiting for players — dropping them is a small thing.
   * confirmed: at least one is set; the player can still leave them to take the new one, but others are counting on them.
   * locked: one is underway or already played — nothing to swap.
   */
  kind: 'soft' | 'confirmed' | 'locked';
  /** The player is the one explaining a table they would leave (it passes to someone else, or is cancelled). */
  asExplainer: boolean;
}

/**
 * Shared by the accept-recommended and join-postulated flows: checks whether adding the player to
 * table `t` would overlap tables they're already on — more than one when `t` is long. All of them can be settled right in the
 * popup: the player leaves them and takes the new one (for a CONFIRMED table the prompt makes clear that others are counting
 * on that roster). Only a table already underway or played can't be left, so then it is just informational. Render
 * `conflictPrompt` with a confirm/cancel UI wired to `handleChoice`; `resolveScheduleConflict` resolves once the player decides
 * (or immediately if there's no conflict at all).
 */
export function useScheduleConflict(code: string, player: Player | null, allTables: Table[]) {
  const [conflictPrompt, setConflictPrompt] = useState<(ConflictPrompt & { resolve: (ok: boolean) => void }) | null>(null);

  function resolveScheduleConflict(t: Table): Promise<boolean> {
    if (!player) return Promise.resolve(false);
    const conflicts = findConflictingTables(player.id, t.startTime, t.endTime, allTables, t.id);
    if (conflicts.length === 0) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const kind = conflicts.some((c) => c.status !== 'recommended' && c.status !== 'confirmed') ? 'locked'
        : conflicts.some((c) => c.status === 'confirmed') ? 'confirmed' : 'soft';
      setConflictPrompt({ conflicts, incoming: t, kind, asExplainer: conflicts.some((c) => c.explainerId === player.id), resolve });
    });
  }

  async function handleConflictChoice(wantsSwap: boolean) {
    if (!conflictPrompt || !player) return;
    const { conflicts, kind, resolve } = conflictPrompt;
    setConflictPrompt(null);
    if (kind !== 'locked' && wantsSwap) {
      // One after the other: each goes through the usual way of stepping down (hands over the explaining, drops a table
      // under its minimum back to waiting, or cancels one with nobody left)
      for (const c of conflicts) await leaveTable(code, c, player.id);
      resolve(true);
    } else {
      resolve(false);
    }
  }

  return { conflictPrompt, resolveScheduleConflict, handleConflictChoice };
}
