import { timingSafeEqual } from 'crypto';
import { adminDb } from './firebaseAdmin';

/**
 * Server-side check of an event's secret admin token (Admin SDK, so it keeps working when Firestore rules stop
 * letting browsers read the token). Compares in constant time.
 */
export async function checkAdminToken(code: string, adminToken: unknown): Promise<boolean> {
  if (typeof adminToken !== 'string' || !adminToken) return false;
  const stored = (await adminDb.doc(`events/${code}/private/config`).get()).data()?.adminToken;
  if (typeof stored !== 'string') return false;
  const a = Buffer.from(stored);
  const b = Buffer.from(adminToken);
  return a.length === b.length && timingSafeEqual(a, b);
}
