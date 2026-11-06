import type { Table } from './types';
import { toMinutes } from './timeUtils';

// A table starting within this many minutes is flagged as "starting soon" (same threshold as the board).
export const SOON_THRESHOLD_MIN = 20;

export type NextTableKind =
  | 'live'    // running right now
  | 'soon'    // starts within SOON_THRESHOLD_MIN
  | 'later'   // starts later today
  | 'future'; // the event hasn't started yet (a later day)

export interface NextTable {
  kind: NextTableKind;
  table: Table;
  /** Minutes until the table starts (only for soon / later). */
  minutesUntilStart?: number;
  /** Minutes until the table ends (only for live). */
  minutesLeft?: number;
}

export function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "25 min", "1 h", "1 h 25 min". */
export function formatMinutes(total: number): string {
  const m = Math.max(0, Math.round(total));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}

/**
 * Which of the player's confirmed tables matters most right now: the one running, otherwise the
 * next to start. Returns null when there is nothing left to show (no confirmed tables, or the
 * event day is over / every table already finished).
 */
export function pickNextTable(myTables: Table[], eventDate: string, now: Date): NextTable | null {
  const upcomingFirst = myTables
    .filter((t) => t.status === 'confirmed' || t.status === 'in-progress')
    .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
  if (upcomingFirst.length === 0) return null;

  const today = localDateStr(now);
  if (eventDate < today) return null;
  if (eventDate > today) return { kind: 'future', table: upcomingFirst[0] };

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const live = upcomingFirst.find((t) => toMinutes(t.startTime) <= nowMin && nowMin < toMinutes(t.endTime));
  if (live) return { kind: 'live', table: live, minutesLeft: toMinutes(live.endTime) - nowMin };

  const next = upcomingFirst.find((t) => toMinutes(t.startTime) > nowMin);
  if (!next) return null;
  const minutesUntilStart = toMinutes(next.startTime) - nowMin;
  return { kind: minutesUntilStart <= SOON_THRESHOLD_MIN ? 'soon' : 'later', table: next, minutesUntilStart };
}
