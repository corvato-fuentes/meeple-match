/** "hace un momento", "hace 5 min", "hace 2 h", "hace 3 días" */
export function timeAgo(timestampMs: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - timestampMs) / 60_000));
  if (minutes < 1) return 'hace un momento';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
}
