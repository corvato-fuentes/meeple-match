import type { Table } from './types';

/** The chips of the admin's "Gestionar mesas": one per state a table can be in, plus all of them. */
export type StatusFilter = 'all' | 'recommended' | 'posted' | 'confirmed' | 'in-progress' | 'completed' | 'cancelled';

export const STATUS_FILTERS: { key: StatusFilter; label: string; activeClass: string }[] = [
  { key: 'all', label: 'Todas', activeClass: 'bg-gray-200 border-gray-200 text-gray-900' },
  { key: 'recommended', label: '💡 Recomendadas', activeClass: 'bg-indigo-500 border-indigo-500 text-white' },
  { key: 'posted', label: '📣 Postuladas', activeClass: 'bg-purple-500 border-purple-500 text-white' },
  { key: 'confirmed', label: '✅ Confirmadas', activeClass: 'bg-green-600 border-green-600 text-black' },
  { key: 'in-progress', label: '🟢 En curso', activeClass: 'bg-emerald-500 border-emerald-500 text-black' },
  { key: 'completed', label: '🏁 Completadas', activeClass: 'bg-gray-500 border-gray-500 text-white' },
  { key: 'cancelled', label: '🚫 Canceladas', activeClass: 'bg-red-600 border-red-600 text-white' },
];

/**
 * A cancelled table worth showing the admin: one that had been set (reached its minimum and was confirmed) and then fell through.
 * Only the mark says so: a cancelled table without it (it only ever waited, or it is from before the mark existed) is noise.
 */
export const everSet = (t: Pick<Table, 'everConfirmed'>): boolean => t.everConfirmed === true;

/**
 * The numbers of the admin's dashboard. They are built so they don't jump around once the event starts: `confirmedTotal` counts every
 * table that got set (waiting to start, underway or finished), so a table going from "confirmada" to "en curso" doesn't make it drop;
 * the second row of the dashboard (shown from the event's start) says in which of those states they are.
 */
export interface TableMetrics {
  recommended: number;
  posted: number;
  /** Set and not cancelled: toStart + inProgress + completed. */
  confirmedTotal: number;
  /** Confirmed, not started yet. */
  toStart: number;
  inProgress: number;
  completed: number;
  /** Only the ones that had been set and fell through (see `everSet`). */
  cancelled: number;
}

export function tableMetrics(tables: Pick<Table, 'status' | 'postedByOwner' | 'everConfirmed'>[]): TableMetrics {
  const count = (f: (t: (typeof tables)[number]) => boolean) => tables.filter(f).length;
  const toStart = count((t) => t.status === 'confirmed');
  const inProgress = count((t) => t.status === 'in-progress');
  const completed = count((t) => t.status === 'completed');
  return {
    recommended: count((t) => matchesStatusFilter(t, 'recommended')),
    posted: count((t) => matchesStatusFilter(t, 'posted')),
    confirmedTotal: toStart + inProgress + completed,
    toStart, inProgress, completed,
    cancelled: count((t) => t.status === 'cancelled' && everSet(t)),
  };
}

/**
 * Does the table belong under this chip. A table still waiting for players is "recommended" when the algorithm proposed it and
 * "postulada" when its owner posted it (the admin's state menu already calls them that), so each is its own chip.
 */
export function matchesStatusFilter(t: Pick<Table, 'status' | 'postedByOwner'>, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'recommended') return t.status === 'recommended' && !t.postedByOwner;
  if (filter === 'posted') return t.status === 'recommended' && !!t.postedByOwner;
  return t.status === filter;
}
