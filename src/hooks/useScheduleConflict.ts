import { useState } from 'react';
import { leaveTable } from '@/lib/firestore';
import { findConflictingTable } from '@/lib/tableAlgorithm';
import type { Player, Table } from '@/lib/types';

export interface ConflictPrompt {
  /** The table the player already holds, which overlaps the one they are taking. */
  conflict: Table;
  /** The table they are trying to take (named on the buttons, so it is clear which one each button affects). */
  incoming: Table;
  /**
   * soft: the other table is still waiting for players — dropping it is a small thing.
   * confirmed: the other table is set; the player can still leave it to take the new one, but others are counting on them.
   * locked: the other table is underway or already played — nothing to swap.
   */
  kind: 'soft' | 'confirmed' | 'locked';
  /** The player is the one explaining the table they would leave (it passes to someone else, or is cancelled). */
  asExplainer: boolean;
}

/**
 * Shared by the accept-recommended and join-postulated flows: checks whether adding the player to
 * table `t` would overlap a table they're already on. Either kind of conflict can be settled right in the
 * popup: the player leaves the other table and takes the new one (for a CONFIRMED table the prompt makes clear
 * that others are counting on that roster). Only a table already underway or played can't be left, so that one
 * is just informational. Render `conflictPrompt` with a confirm/cancel UI wired to
 * `handleChoice`; `resolveScheduleConflict` resolves once the player decides (or immediately if
 * there's no conflict at all).
 */
export function useScheduleConflict(code: string, player: Player | null, allTables: Table[]) {
  const [conflictPrompt, setConflictPrompt] = useState<(ConflictPrompt & { resolve: (ok: boolean) => void }) | null>(null);

  function resolveScheduleConflict(t: Table): Promise<boolean> {
    if (!player) return Promise.resolve(false);
    const conflict = findConflictingTable(player.id, t.startTime, t.endTime, allTables, t.id);
    if (!conflict) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const kind = conflict.status === 'recommended' ? 'soft' : conflict.status === 'confirmed' ? 'confirmed' : 'locked';
      setConflictPrompt({ conflict, incoming: t, kind, asExplainer: conflict.explainerId === player.id, resolve });
    });
  }

  async function handleConflictChoice(wantsSwap: boolean) {
    if (!conflictPrompt || !player) return;
    const { conflict, kind, resolve } = conflictPrompt;
    setConflictPrompt(null);
    if (kind !== 'locked' && wantsSwap) {
      await leaveTable(code, conflict, player.id);
      resolve(true);
    } else {
      resolve(false);
    }
  }

  return { conflictPrompt, resolveScheduleConflict, handleConflictChoice };
}
