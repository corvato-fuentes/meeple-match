import * as webpush from 'web-push';
import { createHash } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebaseAdmin';
import { slotMapFor } from './physicalSlots';
import { planPushes, composePayloads, type PushPayload } from './pushPlan';
import type { MeepleEvent, Table } from './types';

// Server-only (firebase-admin + the VAPID private key). Layout in Firestore, none of it reachable by
// client rules (default deny) — only these helpers, through the /api/push routes, ever touch it:
//   events/{code}/pushSubs/{sha(endpoint|playerId)}   { playerId, subscription, createdAt }
//   events/{code}/pushLedger/{playerId}               { keys: [kind_table_player, …] } — notifications already handled

/** Time zone the event's "HH:MM" times are in — the server runs in UTC, so it must be told. */
export const EVENT_TIMEZONE = process.env.EVENT_TIMEZONE || 'America/Argentina/Cordoba';

/** Most devices one player can register per event (phone, tablet, laptop…). */
export const MAX_DEVICES_PER_PLAYER = 5;

const EVENT_CODE = /^[A-Za-z0-9]{3,12}$/;
export function isValidEventCode(value: unknown): value is string {
  return typeof value === 'string' && EVENT_CODE.test(value);
}

export function pushConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}

let vapidReady = false;
function ensureVapid() {
  if (vapidReady) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT!, process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  vapidReady = true;
}

export function nowInEventTz(d = new Date()): { date: string; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: EVENT_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).map((p) => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

// The server will POST to whatever endpoint a client registers, so only the real push services are
// accepted — otherwise anyone could make it send requests to an arbitrary https URL.
const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];
export function isAllowedEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > 2048) return false;
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && PUSH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch {
    return false;
  }
}

export interface StoredSubscription {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
}

function parseSubscription(raw: unknown): StoredSubscription | null {
  const s = raw as Partial<StoredSubscription> | null;
  if (!s || !isAllowedEndpoint(s.endpoint)) return null;
  const { p256dh, auth } = s.keys ?? ({} as Partial<StoredSubscription['keys']>);
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || !p256dh || !auth || p256dh.length > 200 || auth.length > 100) return null;
  return { endpoint: s.endpoint, expirationTime: s.expirationTime ?? null, keys: { p256dh, auth } };
}

// One doc per (device, player): two people using the same phone each keep their own registration
// instead of the second overwriting the first.
const subDocId = (endpoint: string, playerId: string) =>
  createHash('sha256').update(`${endpoint}|${playerId}`).digest('hex').slice(0, 40);
const eventRef = (code: string) => adminDb.collection('events').doc(code);
const ledgerRef = (code: string, playerId: string) => eventRef(code).collection('pushLedger').doc(playerId);

async function findPlayerByTicket(code: string, ticketCode: string) {
  if (typeof ticketCode !== 'string' || !ticketCode) return null;
  const snap = await eventRef(code).collection('players').where('ticketCode', '==', ticketCode).limit(1).get();
  return snap.empty ? null : snap.docs[0];
}

async function loadTables(code: string): Promise<Table[]> {
  const snap = await eventRef(code).collection('tables').get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Table));
}

/**
 * Marks notification keys as handled for a player and returns the ones THIS caller newly claimed.
 * Runs in a transaction on the player's ledger doc, so two syncs running at once can't both send
 * the same notification.
 */
async function claimKeys(code: string, playerId: string, keys: string[]): Promise<Set<string>> {
  const ref = ledgerRef(code, playerId);
  return adminDb.runTransaction(async (tx) => {
    const sent = new Set<string>(((await tx.get(ref)).data()?.keys as string[] | undefined) ?? []);
    const claimed = keys.filter((k) => !sent.has(k));
    if (claimed.length > 0) tx.set(ref, { keys: FieldValue.arrayUnion(...claimed) }, { merge: true });
    return new Set(claimed);
  });
}

async function releaseKeys(code: string, playerId: string, keys: string[]) {
  await ledgerRef(code, playerId).set({ keys: FieldValue.arrayRemove(...keys) }, { merge: true }).catch(() => {});
}

/**
 * Whatever is already pending for a player the moment they turn notifications on is marked as
 * handled, so they only hear about what happens from now on — not a burst about old tables.
 */
async function seedLedger(code: string, playerId: string, eventDate: string) {
  const { date, minutes } = nowInEventTz();
  const keys = planPushes({ tables: await loadTables(code), playerIds: [playerId], eventDate, today: date, nowMinutes: minutes })
    .filter((p) => p.kind !== 'reminder')
    .map((p) => p.key);
  if (keys.length > 0) await ledgerRef(code, playerId).set({ keys: FieldValue.arrayUnion(...keys) }, { merge: true });
}

export async function saveSubscription(code: string, ticketCode: string, rawSubscription: unknown): Promise<{ ok: boolean; reason?: string }> {
  if (!pushConfigured()) return { ok: false, reason: 'not-configured' };
  const subscription = parseSubscription(rawSubscription);
  if (!subscription) return { ok: false, reason: 'bad-subscription' };
  const [eventSnap, player] = await Promise.all([eventRef(code).get(), findPlayerByTicket(code, ticketCode)]);
  if (!eventSnap.exists || !player) return { ok: false, reason: 'unknown-ticket' };

  const subs = eventRef(code).collection('pushSubs');
  const docId = subDocId(subscription.endpoint, player.id);
  const mine = await subs.where('playerId', '==', player.id).get();
  if (mine.size >= MAX_DEVICES_PER_PLAYER && !mine.docs.some((d) => d.id === docId)) return { ok: false, reason: 'too-many-devices' };

  await subs.doc(docId).set({ playerId: player.id, subscription, createdAt: new Date() });
  await seedLedger(code, player.id, (eventSnap.data() as MeepleEvent).date);
  return { ok: true };
}

export async function removeSubscription(code: string, ticketCode: string, endpoint: unknown): Promise<{ ok: boolean }> {
  if (!isAllowedEndpoint(endpoint)) return { ok: false };
  const player = await findPlayerByTicket(code, ticketCode);
  if (!player) return { ok: false };
  // The doc id includes the player, so this can only ever remove the caller's own registration
  await eventRef(code).collection('pushSubs').doc(subDocId(endpoint, player.id)).delete();
  return { ok: true };
}

type Delivery = 'ok' | 'gone' | 'error';

async function deliver(sub: StoredSubscription, payload: PushPayload): Promise<Delivery> {
  if (process.env.PUSH_DRY_RUN === '1') {
    console.log('[push dry-run]', JSON.stringify({ to: sub.endpoint.slice(0, 48) + '…', ...payload }));
    return 'ok';
  }
  try {
    ensureVapid();
    await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: payload.ttl });
    return 'ok';
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) return 'gone'; // the device unsubscribed / uninstalled
    console.error('[push] delivery failed', status ?? err);
    return 'error';
  }
}

export interface SyncResult {
  sent: number;
  players: number;
  /** How many devices are registered for the event — 0 lets clients stop asking for a while. */
  subscribers: number;
}

/**
 * Looks at the event's current state and sends whatever notification is due to the players who
 * enabled them — once each (the ledger makes it idempotent, so it's safe to call from anywhere,
 * as often as needed): table offers, tables that got confirmed, and reminders before a table starts.
 */
export async function syncEventPush(code: string): Promise<SyncResult> {
  if (!pushConfigured()) return { sent: 0, players: 0, subscribers: 0 };
  const base = eventRef(code);
  const subsSnap = await base.collection('pushSubs').get();
  const none: SyncResult = { sent: 0, players: 0, subscribers: subsSnap.size };
  if (subsSnap.empty) return none;

  const subsByPlayer = new Map<string, { ref: FirebaseFirestore.DocumentReference; sub: StoredSubscription }[]>();
  for (const d of subsSnap.docs) {
    const data = d.data() as { playerId: string; subscription: StoredSubscription };
    const list = subsByPlayer.get(data.playerId) ?? [];
    list.push({ ref: d.ref, sub: data.subscription });
    subsByPlayer.set(data.playerId, list);
  }
  const playerIds = [...subsByPlayer.keys()];

  // One read per subscribed player for the ledger (not one per notification ever sent)
  const [eventSnap, playerSnaps, ledgerSnaps, tables] = await Promise.all([
    base.get(),
    adminDb.getAll(...playerIds.map((id) => base.collection('players').doc(id))),
    adminDb.getAll(...playerIds.map((id) => ledgerRef(code, id))),
    loadTables(code),
  ]);
  if (!eventSnap.exists) return none;
  const event = eventSnap.data() as MeepleEvent;
  const ticketByPlayer = new Map(playerSnaps.filter((s) => s.exists).map((s) => [s.id, s.data()!.ticketCode as string]));
  const sentByPlayer = new Map(ledgerSnaps.map((s) => [s.id, new Set<string>((s.data()?.keys as string[] | undefined) ?? [])]));

  const { date, minutes } = nowInEventTz();
  const fresh = planPushes({ tables, playerIds, eventDate: event.date, today: date, nowMinutes: minutes })
    .filter((p) => !sentByPlayer.get(p.playerId)?.has(p.key));
  if (fresh.length === 0) return none;

  const slotByTableId = slotMapFor(tables.filter((t) => t.status !== 'recommended'), event.settings?.bufferMinutes ?? 0);

  let sent = 0;
  const notified = new Set<string>();
  for (const playerId of new Set(fresh.map((p) => p.playerId))) {
    const ticketCode = ticketByPlayer.get(playerId);
    const devices = subsByPlayer.get(playerId) ?? [];
    if (!ticketCode || devices.length === 0) continue;
    const items = fresh.filter((p) => p.playerId === playerId);
    for (const { payload, keys } of composePayloads(items, { code, ticketCode, slotByTableId, nowMinutes: minutes })) {
      // Claim first: two syncs running at once can't both send the same notification.
      const claimed = await claimKeys(code, playerId, keys);
      if (claimed.size === 0) continue;
      const results = await Promise.all(devices.map(async (d) => ({ d, r: await deliver(d.sub, payload) })));
      for (const { d, r } of results) if (r === 'gone') await d.ref.delete().catch(() => {});
      if (results.every((x) => x.r === 'error')) {
        // Nothing got through (push service hiccup): release the claim so a later sync retries.
        await releaseKeys(code, playerId, [...claimed]);
        continue;
      }
      sent++;
      notified.add(playerId);
    }
  }
  return { sent, players: notified.size, subscribers: subsSnap.size };
}

/** Runs the sync for every event happening today — what an external scheduler calls every few minutes for reminders. */
export async function syncTodaysEvents(): Promise<{ events: number; sent: number }> {
  const { date } = nowInEventTz();
  const events = await adminDb.collection('events').where('date', '==', date).get();
  let sent = 0;
  for (const e of events.docs) sent += (await syncEventPush(e.id)).sent;
  return { events: events.size, sent };
}

export interface BroadcastResult {
  devices: number;
  players: number;
}

/**
 * Sends one message to every device registered for the event — what the admin's "Avisar a todos" uses. Each
 * device gets a link to its own player's ticket. Devices the push service reports as gone are cleaned up.
 */
export async function broadcastToEvent(
  code: string,
  message: { title: string; body: string; tag: string; ttl: number },
): Promise<BroadcastResult> {
  if (!pushConfigured()) return { devices: 0, players: 0 };
  const base = eventRef(code);
  const subsSnap = await base.collection('pushSubs').get();
  if (subsSnap.empty) return { devices: 0, players: 0 };

  const playerIds = [...new Set(subsSnap.docs.map((d) => d.data().playerId as string))];
  const playerSnaps = await adminDb.getAll(...playerIds.map((id) => base.collection('players').doc(id)));
  const ticketByPlayer = new Map(playerSnaps.filter((s) => s.exists).map((s) => [s.id, s.data()!.ticketCode as string]));

  let devices = 0;
  const reached = new Set<string>();
  const CHUNK = 20; // don't open hundreds of connections at once
  for (let i = 0; i < subsSnap.docs.length; i += CHUNK) {
    await Promise.all(subsSnap.docs.slice(i, i + CHUNK).map(async (d) => {
      const { playerId, subscription } = d.data() as { playerId: string; subscription: StoredSubscription };
      const ticketCode = ticketByPlayer.get(playerId);
      if (!ticketCode) return;
      const result = await deliver(subscription, { ...message, url: `/event/${code}/me?ticket=${encodeURIComponent(ticketCode)}` });
      if (result === 'gone') await d.ref.delete().catch(() => {});
      if (result === 'ok') { devices++; reached.add(playerId); }
    }));
  }
  return { devices, players: reached.size };
}
