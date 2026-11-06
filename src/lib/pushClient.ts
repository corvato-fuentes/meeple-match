import { isIOS, isStandalone } from './pwa';

// Browser side of push notifications. Everything degrades to "unsupported" (and the UI hides itself)
// when the VAPID key isn't configured, the browser lacks the APIs, or — on iPhone — the app isn't
// installed to the home screen yet, which is the only way iOS allows web push.

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

// Events the server said have nobody subscribed: stop pinging for a minute so a quiet event doesn't
// cost a server call for every single vote.
const quietUntil = new Map<string, number>();

export type PushStatus =
  | 'unsupported'   // nothing to offer
  | 'needs-install' // iPhone, not installed: install first, then notifications can be enabled
  | 'blocked'       // the user denied the permission in the browser
  | 'off'           // available, not enabled
  | 'on';           // enabled on this device

/** What came out of asking to turn notifications on. */
export type EnableResult = 'on' | 'blocked' | 'dismissed' | 'error';

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function getPushStatus(): Promise<PushStatus> {
  if (typeof window === 'undefined' || !VAPID_PUBLIC_KEY) return 'unsupported';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return isIOS() && !isStandalone() ? 'needs-install' : 'unsupported';
  }
  if (Notification.permission === 'denied') return 'blocked';
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager.getSubscription();
  return Notification.permission === 'granted' && subscription ? 'on' : 'off';
}

async function postSubscription(code: string, ticketCode: string, subscription: PushSubscription): Promise<boolean> {
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, ticketCode, subscription: subscription.toJSON() }),
  });
  if (res.ok) quietUntil.delete(code); // there is somebody to notify now
  return res.ok;
}

/** Must be called from a tap (iOS only shows the permission dialog in response to a user gesture). */
export async function enablePush(code: string, ticketCode: string): Promise<EnableResult> {
  if (!VAPID_PUBLIC_KEY) return 'error';
  const permission = await Notification.requestPermission();
  if (permission === 'denied') return 'blocked';
  if (permission !== 'granted') return 'dismissed'; // closed the prompt without choosing
  try {
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    // `ready` never settles if the worker can't activate — don't leave the button spinning forever
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('service worker timeout')), 10_000)),
    ]);
    const subscription = (await registration.pushManager.getSubscription())
      ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) });
    return (await postSubscription(code, ticketCode, subscription)) ? 'on' : 'error';
  } catch (err) {
    console.error('[push] could not enable', err);
    return 'error';
  }
}

/**
 * The browser's subscription belongs to the whole site, but the server registers devices per event
 * and ticket. A phone that enabled notifications for one event (or another ticket) is "on" in the
 * browser yet unknown to this event's server — so each session, re-register the existing
 * subscription for this ticket (it's an idempotent upsert) instead of trusting the browser's state.
 */
export async function syncExistingSubscription(code: string, ticketCode: string): Promise<void> {
  const flag = `mm_push_registered_${code}_${ticketCode}`;
  try { if (sessionStorage.getItem(flag)) return; } catch { /* sessionStorage blocked: just register again */ }
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  if (await postSubscription(code, ticketCode, subscription)) {
    try { sessionStorage.setItem(flag, '1'); } catch { /* ignore */ }
  }
}

export async function disablePush(code: string, ticketCode: string): Promise<PushStatus> {
  try {
    const registration = await navigator.serviceWorker.getRegistration('/');
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, ticketCode, endpoint: subscription.endpoint }),
      }).catch(() => {});
      await subscription.unsubscribe();
      try { sessionStorage.removeItem(`mm_push_registered_${code}_${ticketCode}`); } catch { /* ignore */ }
    }
  } catch (err) {
    console.error('[push] could not disable', err);
  }
  return 'off';
}

// ── "something changed" pings ────────────────────────────────────────────────

let syncTimer: ReturnType<typeof setTimeout> | undefined;
let pendingCode: string | null = null;
let listening = false;
function sendSync(code: string) {
  fetch('/api/push/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
    keepalive: true, // still goes out if the page is closing
  })
    .then((res) => res.json())
    .then((json: { subscribers?: number }) => { if (json.subscribers === 0) quietUntil.set(code, Date.now() + 60_000); })
    .catch(() => {});
}

/** Sends the pending ping right now (used when the page is about to go away). */
function flushSync() {
  clearTimeout(syncTimer);
  syncTimer = undefined;
  if (pendingCode) {
    const code = pendingCode;
    pendingCode = null;
    sendSync(code);
  }
}

/**
 * Tells the server something changed that players may need to hear about (tables generated,
 * accepted, confirmed…). Fire-and-forget: it never blocks or fails the action that called it, and
 * is skipped entirely when notifications aren't configured for this deployment. Calls that come in a
 * burst (an action followed right away by table generation) collapse into one request sent after the
 * last; if the page is hidden or closed before that, it goes out immediately.
 */
export function requestPushSync(eventCode: string): void {
  if (typeof window === 'undefined' || !VAPID_PUBLIC_KEY) return;
  if ((quietUntil.get(eventCode) ?? 0) > Date.now()) return;
  if (!listening) {
    listening = true;
    window.addEventListener('pagehide', flushSync);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSync(); });
  }
  pendingCode = eventCode;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(flushSync, 800);
}
