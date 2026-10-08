import { useState } from 'react';
import { leaveRecommendedTable } from '@/lib/firestore';
import { findConflictingTable } from '@/lib/tableAlgorithm';
import type { Player, Table } from '@/lib/types';

export interface ConflictPrompt {
  conflict: Table;
  kind: 'hard' | 'soft';
}

/**
 * Shared by the accept-recommended and join-postulated flows: checks whether adding the player to
 * table `t` would overlap a table they're already on. A CONFIRMED conflict blocks the action
 * outright (someone else may already be counting on that roster) — surfaced as an informational
 * prompt. A still-open one (recommended, not yet full) is a soft commitment — the prompt offers to
 * drop it in favor of the new one. Render `conflictPrompt` with a confirm/cancel UI wired to
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
      setConflictPrompt({ conflict, kind: conflict.status !== 'recommended' ? 'hard' : 'soft', resolve });
    });
  }

  async function handleConflictChoice(wantsSwap: boolean) {
    if (!conflictPrompt || !player) return;
    const { conflict, kind, resolve } = conflictPrompt;
    setConflictPrompt(null);
    if (kind === 'soft' && wantsSwap) {
      await leaveRecommendedTable(code, conflict.id, player.id);
      resolve(true);
    } else {
      resolve(false);
    }
  }

  return { conflictPrompt, resolveScheduleConflict, handleConflictChoice };
}
