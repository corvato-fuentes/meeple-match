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
