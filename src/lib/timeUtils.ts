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

/** True once the event's scheduled end (date + endTime) has passed. */
export function isEventOver(date: string, endTime: string): boolean {
  return new Date() >= new Date(`${date}T${endTime}:00`);
}

// Always derived from the event's own schedule, never stored or admin-picked — before the event's
// start it's "open" (registration ongoing), between start and end it's "live", after end it's
// "closed" (also gates new registrations, see event/[code]/page.tsx).
export function computeEventStatus(date: string, startTime: string, endTime: string): "open" | "live" | "closed" {
  const now = new Date();
  if (now < new Date(`${date}T${startTime}:00`)) return "open";
  if (now < new Date(`${date}T${endTime}:00`)) return "live";
  return "closed";
}
