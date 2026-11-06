import { timingSafeEqual } from 'crypto';
import { adminDb, adminAuth } from './firebaseAdmin';

// Server-only. The app has no user accounts: an event admin is whoever holds the secret admin link, and a
// player is whoever holds their ticket. The Firestore rules can't see either secret, so these helpers check
// them here (with the Admin SDK, which bypasses the rules) and hand the browser a Firebase custom token whose
// claims the rules DO check — `adminFor` for an event's admin, `playerFor` + `playerId` for a registered player.
// The admin token itself is never readable from the browser (events/{code}/private/config is locked down).

const EVENT_CODE = /^[A-Za-z0-9]{3,12}$/;
export function isValidEventCode(value: unknown): value is string {
  return typeof value === 'string' && EVENT_CODE.test(value);
}

/** Compares two secrets without leaking, through timing, how many leading characters matched. */
function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function verifyAdminTokenServer(code: string, adminToken: unknown): Promise<boolean> {
  if (!isValidEventCode(code) || typeof adminToken !== 'string' || !adminToken) return false;
  const snap = await adminDb.doc(`events/${code}/private/config`).get();
  const stored = snap.data()?.adminToken;
  return typeof stored === 'string' && sameSecret(stored, adminToken);
}

export async function findPlayerByTicketServer(code: string, ticketCode: unknown): Promise<{ id: string } | null> {
  if (!isValidEventCode(code) || typeof ticketCode !== 'string' || !ticketCode) return null;
  const snap = await adminDb.collection(`events/${code}/players`).where('ticketCode', '==', ticketCode).limit(1).get();
  return snap.empty ? null : { id: snap.docs[0].id };
}

/** Sign-in token for the admin of `code` (call only after verifyAdminTokenServer succeeded). */
export function mintAdminToken(code: string): Promise<string> {
  return adminAuth.createCustomToken(`admin:${code}`, { adminFor: code });
}

/** Sign-in token for one registered player of `code` (call only after the ticket was verified). */
export function mintPlayerToken(code: string, playerId: string): Promise<string> {
  return adminAuth.createCustomToken(`player:${code}:${playerId}`, { playerFor: code, playerId });
}

export async function verifyMathTradeAdminTokenServer(code: string, adminToken: unknown): Promise<boolean> {
  if (!isValidEventCode(code) || typeof adminToken !== 'string' || !adminToken) return false;
  const snap = await adminDb.doc(`mathtrades/${code}/private/config`).get();
  const stored = snap.data()?.adminToken;
  return typeof stored === 'string' && sameSecret(stored, adminToken);
}
