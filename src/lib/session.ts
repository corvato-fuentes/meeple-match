import { signInWithCustomToken } from 'firebase/auth';
import { auth } from './firebase';

// Browser side of the sign-in described in serverAuth.ts. There are no user accounts: the server checks the
// secret (admin link / ticket) and returns a Firebase custom token, and signing in with it gives this browser the
// claim the Firestore rules look for. One browser holds one session at a time (the last page opened wins), except
// that an admin session is never replaced by a player one for the same event — an admin can do everything a player can.

let pending: Promise<unknown> = Promise.resolve();

async function post(path: string, body: unknown): Promise<{ ok: boolean; json: { customToken?: string } | null }> {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { ok: res.ok, json: await res.json().catch(() => null) };
}

/**
 * Checks the admin token on the server and signs this browser in as that event's admin.
 * Resolves true when the token is valid. If the token is valid but the sign-in itself fails (network, Auth
 * hiccup) it still resolves true, so the admin sees the panel instead of "acceso denegado"; writes that need the
 * admin session would then be refused by the rules.
 */
export function signInAsAdmin(code: string, adminToken: string): Promise<boolean> {
  const run = async () => {
    const { ok, json } = await post('/api/auth/admin', { code, adminToken });
    if (!ok || !json?.customToken) return false;
    if (auth.currentUser?.uid !== `admin:${code}`) {
      try { await signInWithCustomToken(auth, json.customToken); } catch (err) { console.error('[auth] admin sign-in failed', err); }
    }
    return true;
  };
  const result = pending.then(run, run);
  pending = result.catch(() => {});
  return result;
}

/**
 * Signs this browser in as a registered player (checked on the server by ticket). Fire-and-forget by design —
 * pages keep rendering while it happens; operations that need the session call whenSessionReady() first.
 */
export function startPlayerSession(code: string, ticketCode: string, playerId?: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve(); // server-side callers have no browser session
  const uid = auth.currentUser?.uid;
  if (uid === `admin:${code}` || (playerId && uid === `player:${code}:${playerId}`)) return Promise.resolve();
  const run = async () => {
    try {
      const { ok, json } = await post('/api/auth/player', { code, ticketCode });
      if (ok && json?.customToken) await signInWithCustomToken(auth, json.customToken);
    } catch (err) {
      console.error('[auth] player sign-in failed', err);
    }
  };
  const result = pending.then(run, run);
  pending = result;
  return result.then(() => undefined);
}

/** Waits (briefly) for a sign-in that is still in flight, so a delete issued right after page load isn't refused. */
export async function whenSessionReady(): Promise<void> {
  await Promise.race([pending.catch(() => {}), new Promise<void>((resolve) => setTimeout(resolve, 8000))]);
}

/** Math-trade admin check (no custom token needed there: the rules don't depend on it). */
export async function verifyMathTradeAdminOnServer(code: string, adminToken: string): Promise<boolean> {
  return (await post('/api/auth/mathtrade-admin', { code, adminToken })).ok;
}
