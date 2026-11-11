import type { Table } from './types';

/**
 * Where one player stands on one table — what the admin wants to see next to what they voted:
 *  - confirmed: seated at a table that is set (or already played)
 *  - accepted:  said yes to a recommended/posted table that still needs more people
 *  - offered:   the table was offered to them and they haven't answered
 *  - queued:    built for them, but still waiting for someone to confirm they explain it (not offered yet)
 *  - rejected:  declined that table
 */
export type PlayerTableState = 'confirmed' | 'accepted' | 'offered' | 'queued' | 'rejected';

export interface PlayerTableEntry {
  table: Table;
  state: PlayerTableState;
  /** Seated and the one explaining it. */
  explains: boolean;
}

const SET_STATUSES: Table['status'][] = ['confirmed', 'in-progress', 'completed'];

/** Every table that involves the player (cancelled ones don't count), in time order. */
export function playerTableEntries(playerId: string, tables: Table[]): PlayerTableEntry[] {
  const entries: PlayerTableEntry[] = [];
  for (const t of tables) {
    if (t.status === 'cancelled') continue;
    if (t.playerIds.includes(playerId)) {
      // While a table waits for an explainer, `explainerId` is only a placeholder: nobody explains it yet
      entries.push({ table: t, state: SET_STATUSES.includes(t.status) ? 'confirmed' : 'accepted', explains: !t.awaitingExplainer && t.explainerId === playerId });
    } else if (t.status === 'recommended' || t.status === 'confirmed') {
      if ((t.rejectedIds ?? []).includes(playerId)) entries.push({ table: t, state: 'rejected', explains: false });
      else if ((t.candidateIds ?? []).includes(playerId)) entries.push({ table: t, state: 'offered', explains: false });
      else if (!t.postedByOwner && (t.queuedIds ?? []).includes(playerId)) entries.push({ table: t, state: 'queued', explains: false });
    }
  }
  return entries.sort((a, b) => a.table.startTime.localeCompare(b.table.startTime));
}

export function countByState(entries: PlayerTableEntry[]): Record<PlayerTableState, number> {
  const counts: Record<PlayerTableState, number> = { confirmed: 0, accepted: 0, offered: 0, queued: 0, rejected: 0 };
  for (const e of entries) counts[e.state]++;
  return counts;
}
