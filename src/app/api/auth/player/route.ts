import { NextResponse } from 'next/server';
import { isValidEventCode, findPlayerByTicketServer, mintPlayerToken } from '@/lib/serverAuth';
import { rateLimited, clientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Checks a ticket on the server and, if it belongs to a registered player, returns a Firebase custom token
 * carrying `playerFor` / `playerId` — what the Firestore rules use to let a player delete only their own games
 * and to prune stale tables. The limit is generous: a whole venue can sit behind one IP.
 */
export async function POST(request: Request) {
  if (rateLimited(`auth-player:${clientIp(request)}`, 600, 60_000)) return NextResponse.json({ ok: false }, { status: 429 });
  const body = await request.json().catch(() => null) as { code?: string; ticketCode?: string } | null;
  if (!body || !isValidEventCode(body.code) || typeof body.ticketCode !== 'string') {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const player = await findPlayerByTicketServer(body.code, body.ticketCode);
  if (!player) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true, playerId: player.id, customToken: await mintPlayerToken(body.code, player.id) });
}
