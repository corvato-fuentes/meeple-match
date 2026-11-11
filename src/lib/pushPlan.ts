import type { Table } from './types';
import { toMinutes } from './timeUtils';
import { isOfferFor } from './offers';

// Pure planning of which push notifications are due and what they say. No Firestore / web-push
// here, so the rules are easy to test; src/lib/pushServer.ts does the I/O around it.

export type PushKind = 'offer' | 'confirmed' | 'reminder';

/** How long before a confirmed table starts the reminder goes out. */
export const REMINDER_MINUTES = 15;

export interface PlannedPush {
  /** Stable id of this (kind, table, player) notification — the ledger key that stops repeats. */
  key: string;
  kind: PushKind;
  playerId: string;
  table: Table;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  /** Notifications sharing a tag replace each other instead of piling up. */
  tag: string;
  /** Seconds the push service keeps trying to deliver it. */
  ttl: number;
}

export const pushKey = (kind: PushKind, tableId: string, playerId: string) => `${kind}_${tableId}_${playerId}`;

interface PlanInput {
  tables: Table[];
  playerIds: string[];
  /** Event day, "YYYY-MM-DD". */
  eventDate: string;
  /** Today in the event's time zone, "YYYY-MM-DD", and minutes since midnight there. */
  today: string;
  nowMinutes: number;
}

/**
 * What each of the given players should be told right now:
 *  - offer: an algorithm-recommended table is waiting for their answer;
 *  - confirmed: a table they are seated at (or explain) just became confirmed;
 *  - reminder: a confirmed table of theirs starts within REMINDER_MINUTES (event day only).
 * Tables that already ended, and everything once the event day is over, are skipped.
 */
export function planPushes({ tables, playerIds, eventDate, today, nowMinutes }: PlanInput): PlannedPush[] {
  if (eventDate < today) return [];
  const isEventDay = eventDate === today;
  const planned: PlannedPush[] = [];

  for (const t of tables) {
    if (t.status === 'cancelled' || t.status === 'completed') continue;
    const start = toMinutes(t.startTime);
    const end = toMinutes(t.endTime);
    if (isEventDay && end <= nowMinutes) continue;

    for (const pid of playerIds) {
      // Offers go to the people who still have to answer — also for a confirmed table that has free places
      if ((t.status === 'recommended' || t.status === 'confirmed') && isOfferFor(t, pid)) {
        planned.push({ key: pushKey('offer', t.id, pid), kind: 'offer', playerId: pid, table: t });
      }
      if (t.status === 'recommended') continue;
      // confirmed / in-progress
      if (!t.playerIds.includes(pid) && t.explainerId !== pid) continue;
      planned.push({ key: pushKey('confirmed', t.id, pid), kind: 'confirmed', playerId: pid, table: t });
      if (t.status === 'confirmed' && isEventDay) {
        const until = start - nowMinutes;
        if (until > 0 && until <= REMINDER_MINUTES) {
          planned.push({ key: pushKey('reminder', t.id, pid), kind: 'reminder', playerId: pid, table: t });
        }
      }
    }
  }
  return planned;
}

interface ComposeContext {
  code: string;
  ticketCode: string;
  /** Physical table number per table id (same numbering as the full schedule). */
  slotByTableId: Map<string, number>;
  nowMinutes: number;
}

const list = (names: string[]) => (names.length <= 2 ? names.join(' y ') : `${names.slice(0, 2).join(', ')} y ${names.length - 2} más`);

/** Turns one player's due notifications into the actual messages: one per kind, summarizing when there are several. */
export function composePayloads(items: PlannedPush[], ctx: ComposeContext): { payload: PushPayload; keys: string[] }[] {
  const ticketQuery = `?ticket=${encodeURIComponent(ctx.ticketCode)}`;
  const meUrl = `/event/${ctx.code}/me${ticketQuery}`;
  const out: { payload: PushPayload; keys: string[] }[] = [];
  const byKind = (k: PushKind) => items.filter((i) => i.kind === k).sort((a, b) => toMinutes(a.table.startTime) - toMinutes(b.table.startTime));
  const slotText = (t: Table) => { const s = ctx.slotByTableId.get(t.id); return s != null ? ` · Mesa #${s}` : ''; };

  const offers = byKind('offer');
  if (offers.length === 1) {
    const t = offers[0].table;
    out.push({
      keys: [offers[0].key],
      payload: { title: '🟡 Te ofrecen una mesa', body: `${t.gameName} · ${t.startTime}–${t.endTime}. Entrá para aceptarla o rechazarla.`,
        url: `/event/${ctx.code}/recommended${ticketQuery}`, tag: `offer-${ctx.code}`, ttl: 3600 },
    });
  } else if (offers.length > 1) {
    out.push({
      keys: offers.map((o) => o.key),
      payload: { title: `🟡 Tenés ${offers.length} mesas para aceptar`, body: `${list(offers.map((o) => o.table.gameName))}. Entrá para responder.`,
        url: `/event/${ctx.code}/recommended${ticketQuery}`, tag: `offer-${ctx.code}`, ttl: 3600 },
    });
  }

  const confirmed = byKind('confirmed');
  if (confirmed.length === 1) {
    const t = confirmed[0].table;
    out.push({
      keys: [confirmed[0].key],
      payload: { title: '✅ Mesa confirmada', body: `${t.gameName} · ${t.startTime}–${t.endTime}${slotText(t)}`,
        url: meUrl, tag: `confirmed-${ctx.code}`, ttl: 3600 },
    });
  } else if (confirmed.length > 1) {
    out.push({
      keys: confirmed.map((c) => c.key),
      payload: { title: `✅ Se confirmaron ${confirmed.length} mesas`, body: `${list(confirmed.map((c) => c.table.gameName))}. Mirá los horarios en tu ticket.`,
        url: meUrl, tag: `confirmed-${ctx.code}`, ttl: 3600 },
    });
  }

  const reminders = byKind('reminder');
  if (reminders.length > 0) {
    const t = reminders[0].table;
    const mins = Math.max(1, toMinutes(t.startTime) - ctx.nowMinutes);
    out.push({
      keys: reminders.map((r) => r.key),
      payload: { title: `⏰ Tu mesa empieza en ${mins} min`, body: `${t.gameName} · ${t.startTime}${slotText(t)}`,
        url: meUrl, tag: `reminder-${ctx.code}`, ttl: 600 },
    });
  }
  return out;
}
