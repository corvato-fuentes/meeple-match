// Tiny in-memory rate limiter for the public API routes. It is per server instance (serverless
// instances don't share memory), so it's a brake on floods from a single client, not a hard global
// quota — which is what these routes need: they only ever do a bounded amount of work per call.

const buckets = new Map<string, { count: number; resetAt: number }>();

/** True when `key` has used up its `max` calls in the current `windowMs` window (and counts this call). */
export function rateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  if (buckets.size > 5000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  bucket.count++;
  return bucket.count > max;
}

/** Best-effort caller address (first hop of x-forwarded-for on Vercel). */
export function clientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
}
