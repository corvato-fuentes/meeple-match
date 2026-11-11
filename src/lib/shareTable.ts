import type { Game, Table } from './types';
import { minSeats } from './seats';

/** What a shared link to a table tells (and, on its own page, shows) — counts only, never names. */
export interface ShareInfo {
  gameName: string;
  startTime: string;
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

export function shareInfoOf(t: Pick<Table, 'gameName' | 'startTime' | 'status' | 'playerIds'>, game: Pick<Game, 'minPlayers' | 'maxPlayers'>): ShareInfo {
  return { gameName: t.gameName, startTime: t.startTime, status: t.status, seated: t.playerIds.length, minSeats: minSeats(game), maxPlayers: game.maxPlayers };
}

/** "Falta 1 para jugar Dune a las 14:45" / "Hay lugar para 2 más en Dune a las 14:45". */
export function shareHeadline(i: ShareInfo): string {
  const missing = Math.max(0, i.minSeats - i.seated);
  if (i.status === 'recommended' && missing > 0) {
    return `${missing === 1 ? 'Falta' : 'Faltan'} ${missing} para jugar ${i.gameName} a las ${i.startTime}`;
  }
  const free = Math.max(0, i.maxPlayers - i.seated);
  return `Hay lugar para ${free} más en ${i.gameName} a las ${i.startTime}`;
}

/** How full it is, in words, for the shared page. */
export function seatsLine(i: ShareInfo): string {
  const missing = Math.max(0, i.minSeats - i.seated);
  const base = `${i.seated} anotado${i.seated === 1 ? '' : 's'} · caben hasta ${i.maxPlayers}`;
  return missing > 0 ? `${base} · faltan ${missing} para confirmar` : `${base} · ya está confirmada`;
}
