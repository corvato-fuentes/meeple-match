import { minSeats } from './seats';
import { isShareableTable, type ShareInfo } from './shareTable';
import type { Game, Table } from './types';

// Server-only. Reads one table for its shared link (the page's preview and the link preview WhatsApp and others show).
// Only counts and the game's public data come out: never the names of the people at the table.

export interface SharedTablePreview extends ShareInfo {
  eventName: string;
  date: string;
  endTime: string;
  imageUrl: string | null;
  /** Still has a place and has not started: the link can invite people to it. */
  open: boolean;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export async function getSharedTable(code: string, tableId: string): Promise<SharedTablePreview | null> {
  if (!SAFE_ID.test(code) || !SAFE_ID.test(tableId)) return null;
  // Loaded here so merely importing this file (the page, at build time) doesn't need the service account
  const { adminDb } = await import('./firebaseAdmin');
  const [eventSnap, tableSnap] = await Promise.all([
    adminDb.doc(`events/${code}`).get(),
    adminDb.doc(`events/${code}/tables/${tableId}`).get(),
  ]);
  if (!eventSnap.exists || !tableSnap.exists) return null;
  const table = tableSnap.data() as Table;
  const gameSnap = await adminDb.doc(`events/${code}/games/${table.gameId}`).get();
  if (!gameSnap.exists) return null;
  const game = gameSnap.data() as Game;
  return {
    eventName: (eventSnap.data()?.name as string) ?? '',
    date: (eventSnap.data()?.date as string) ?? '',
    gameName: table.gameName,
    startTime: table.startTime,
    endTime: table.endTime,
    status: table.status,
    seated: table.playerIds.length,
    minSeats: minSeats(game),
    maxPlayers: game.maxPlayers,
    imageUrl: game.imageUrl ?? null,
    open: isShareableTable(table, game),
  };
}
