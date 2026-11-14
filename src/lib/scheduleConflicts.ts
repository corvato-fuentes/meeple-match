import type { Table } from './types';

/**
 * A table of the player's that overlaps the one they are taking, but that is not worth stopping them for: it is still waiting for
 * players (it never got confirmed), and they are not the one explaining it. Nobody is counting on it yet, so taking the other table
 * just leaves this one — and they are told afterwards, instead of being asked first as if it were a conflict.
 */
export const isQuietConflict = (t: Pick<Table, 'status' | 'explainerId'>, playerId: string): boolean =>
  t.status === 'recommended' && t.explainerId !== playerId;

/** The tables that need a decision (confirmed ones, ones they explain…), and the ones that are simply left. */
export function splitConflicts<T extends Pick<Table, 'status' | 'explainerId'>>(conflicts: T[], playerId: string): { loud: T[]; quiet: T[] } {
  return {
    loud: conflicts.filter((c) => !isQuietConflict(c, playerId)),
    quiet: conflicts.filter((c) => isQuietConflict(c, playerId)),
  };
}
