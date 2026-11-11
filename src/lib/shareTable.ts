import type { Game, Table } from './types';
import { minSeats } from './seats';

/** What a shared link to a table tells (and, on its own page, shows) — counts only, never names. */
export interface ShareInfo {
  gameName: string;
  /** The event's day (YYYY-MM-DD): a link opens days later, so it has to say which day the table is. */
  date?: string;
  /** Where the event is, so people know where to go. */
  location?: string;
  startTime: string;
  endTime?: string;
  status: Table['status'];
  seated: number;
  /** People needed to confirm it. */
  minSeats: number;
  maxPlayers: number;
}

/** Where the person goes after registering / entering their code, so they land back on the table they were sent. */
export const pendingTableKey = (code: string) => 'mm_pending_table_' + code;

/** The link people share. It never carries a ticket code: that one is personal and must not travel with the link. */
export const shareLink = (origin: string, code: string, tableId: string) => `${origin}/event/${code}/mesa/${tableId}`;

/**
 * Can people be invited to this table? It has to be waiting for players or confirmed with a free place. A table
 * still waiting for someone to confirm they explain it isn't: joining it would mean taking that role.
 */
export function isShareableTable(t: Pick<Table, 'status' | 'playerIds' | 'awaitingExplainer'>, game: Pick<Game, 'maxPlayers'> | undefined): boolean {
  if (!game) return false;
  if (t.status !== 'recommended' && t.status !== 'confirmed') return false;
  if (t.awaitingExplainer) return false;
  return t.playerIds.length < game.maxPlayers;
}

/** "sábado 15 de noviembre" for an event day like "2026-11-15" (the same day wherever the server or the phone is). */
export function dayLabel(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  return new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])))
    .replace(',', ''); // some versions write "domingo, 15 de noviembre"
}

export function shareInfoOf(
  t: Pick<Table, 'gameName' | 'startTime' | 'endTime' | 'status' | 'playerIds'>, game: Pick<Game, 'minPlayers' | 'maxPlayers'>,
  event?: { date?: string; location?: string }
): ShareInfo {
  return { gameName: t.gameName, date: event?.date, location: event?.location, startTime: t.startTime, endTime: t.endTime, status: t.status, seated: t.playerIds.length, minSeats: minSeats(game), maxPlayers: game.maxPlayers };
}

/**
 * What the table needs, before the game's name. It only says there is room — not how many are missing, which is a number
 * that is already old by the time someone reads it.
 */
export function sharePrompt(): string {
  return 'Hay cupos para jugar';
}

/** "Hay cupos para jugar Dune"; `bold` wraps the game in *…* the way WhatsApp reads it. */
function leadLine(i: ShareInfo, bold: boolean): string {
  return `${sharePrompt()} ${bold ? `*${i.gameName}*` : i.gameName}`;
}

/** "Hay cupos para jugar Dune el sábado 15 de noviembre a las 14:45" — the title of the link and of its page. */
export function shareHeadline(i: ShareInfo): string {
  return `${leadLine(i, false)} ${i.date ? `el ${dayLabel(i.date)} ` : ''}a las ${i.startTime}`;
}

/**
 * The message people send: one fact per line with its icon, the game in bold (WhatsApp's *…*), and the link last.
 * No names of people, like the page it points at.
 */
export function shareMessage(i: ShareInfo, eventName: string, url: string): string {
  const facts = [
    `🎲 ${leadLine(i, true)}`,
    i.date && `📅 ${dayLabel(i.date)}`,
    `🕐 ${i.startTime}${i.endTime ? `–${i.endTime}` : ''}`,
    i.location && `📍 ${i.location}`,
    eventName && `🎪 ${eventName}`,
  ].filter(Boolean);
  return `${facts.join('\n')}\n\n👉 Sumate acá: ${url}`;
}

/** How full it is, in words, for the shared page. */
export function seatsLine(i: ShareInfo): string {
  const missing = Math.max(0, i.minSeats - i.seated);
  const base = `${i.seated} anotado${i.seated === 1 ? '' : 's'} · caben hasta ${i.maxPlayers}`;
  return missing > 0 ? `${base} · faltan ${missing} para confirmar` : `${base} · ya está confirmada`;
}
