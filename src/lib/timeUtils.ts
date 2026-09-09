// Converts "HH:MM" to minutes since midnight
export function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

// Converts minutes since midnight to "HH:MM"
export function toTimeString(minutes: number): string {
  const h = Math.floor(minutes / 60).toString().padStart(2, "0");
  const m = (minutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

export function timeWindowOverlap(
  a: { start: string; end: string },
  b: { start: string; end: string }
): { start: string; end: string } | null {
  const start = Math.max(toMinutes(a.start), toMinutes(b.start));
  const end = Math.min(toMinutes(a.end), toMinutes(b.end));
  if (start >= end) return null;
  return { start: toTimeString(start), end: toTimeString(end) };
}

export function windowDuration(start: string, end: string): number {
  return toMinutes(end) - toMinutes(start);
}

/**
 * Once inside this window, player registrations/votes stop auto-triggering full regenerations —
 * the grid freezes so only the admin can still adjust it. By default the window starts at
 * midnight of the event day; freezeHours shifts that point earlier (configurable per event).
 */
export function isAutoGenerationLocked(date: string, freezeHours: number): boolean {
  const midnightEventDay = new Date(`${date}T00:00:00`);
  const lockAt = new Date(midnightEventDay.getTime() - freezeHours * 60 * 60 * 1000);
  return new Date() >= lockAt;
}
