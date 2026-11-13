import type { SavedEvent, SavedPlayerEvent } from './myEvents';

/** An event this device knows about — one the person organizes, one they have a ticket for, or both — as one card on the home page. */
export interface HomeEventCard {
  code: string;
  name: string;
  date: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  admin?: { adminToken: string };
  ticket?: { ticketCode: string; playerName: string };
}

/**
 * One card per event: the organizer entries and the tickets this device saved, joined by event code.
 * `bare` are tickets known only by their code (no name or date saved): they join an existing card, or make one the live event fills in.
 */
export function mergeSavedEvents(
  admin: SavedEvent[], player: SavedPlayerEvent[], bare: { code: string; ticketCode: string }[] = [],
): HomeEventCard[] {
  const byCode = new Map<string, HomeEventCard>();
  for (const a of admin) byCode.set(a.code, { code: a.code, name: a.name, date: a.date, admin: { adminToken: a.adminToken } });
  for (const p of player) {
    const card = byCode.get(p.code) ?? { code: p.code, name: p.name, date: p.date };
    card.ticket = { ticketCode: p.ticketCode, playerName: p.playerName };
    byCode.set(p.code, card);
  }
  for (const b of bare) {
    const card = byCode.get(b.code) ?? { code: b.code, name: '', date: '' };
    if (!card.ticket) card.ticket = { ticketCode: b.ticketCode, playerName: '' };
    byCode.set(b.code, card);
  }
  return [...byCode.values()];
}

export type WhenTone = 'live' | 'soon' | 'later' | 'past';

/**
 * When the event is, in words a person reads at a glance: "En curso", "Hoy", "Mañana", "En 3 días", "Finalizó".
 * Without the hours it counts the whole day.
 */
export function whenOf(card: Pick<HomeEventCard, 'date' | 'startTime' | 'endTime'>, now: Date): { label: string; tone: WhenTone } {
  const start = new Date(`${card.date}T${card.startTime ?? '00:00'}:00`);
  const end = new Date(`${card.date}T${card.endTime ?? '23:59'}:00`);
  if (Number.isNaN(start.getTime())) return { label: '', tone: 'later' };
  if (now >= end) return { label: 'Finalizó', tone: 'past' };
  if (now >= start) return { label: 'En curso', tone: 'live' };
  const dayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((dayOf(start) - dayOf(now)) / 86_400_000);
  if (days <= 0) return { label: 'Hoy', tone: 'soon' };
  if (days === 1) return { label: 'Mañana', tone: 'soon' };
  return { label: `En ${days} días`, tone: days <= 7 ? 'soon' : 'later' };
}

/** What is happening or coming first goes first; events already over go last, the most recent one first. */
export function sortCards<T extends Pick<HomeEventCard, 'date' | 'startTime' | 'endTime'>>(cards: T[], now: Date): T[] {
  // A card whose date is not known yet goes after the dated ones
  const at = (c: T) => new Date(`${c.date}T${c.startTime ?? '00:00'}:00`).getTime() || 8.64e15;
  const rank = (c: T) => (whenOf(c, now).tone === 'past' ? 1 : 0);
  return [...cards].sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? at(a) - at(b) : at(b) - at(a)));
}
