import type { Table } from './types';

/**
 * A table of the player's that overlaps the one they are taking, but is not a conflict: it is still waiting for players (it never
 * got confirmed), so nobody is counting on it yet. Taking the other table means stepping out of it — they are told first, as a
 * heads-up, not warned as if two set tables clashed. (If they explain it, the heads-up also says what happens with the explaining.)
 */
export const isQuietConflict = (t: Pick<Table, 'status'>): boolean => t.status === 'recommended';

/** The tables that are a real clash (confirmed or underway), and the ones that are only a heads-up. */
export function splitConflicts<T extends Pick<Table, 'status'>>(conflicts: T[]): { loud: T[]; quiet: T[] } {
  return {
    loud: conflicts.filter((c) => !isQuietConflict(c)),
    quiet: conflicts.filter((c) => isQuietConflict(c)),
  };
}
