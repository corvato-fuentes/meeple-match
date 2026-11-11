import { NextRequest, NextResponse } from 'next/server';
import { isValidEventCode } from '@/lib/pushServer';
import { rateLimited, clientIp } from '@/lib/rateLimit';
import { findPlayerByTicket } from '@/lib/checkinServer';
import { listGameRequests, applyRequestAction, type RequestAction } from '@/lib/gameRequestsServer';

export const runtime = 'nodejs';

/** The event's "games people would like someone to bring", from the point of view of the player whose ticket this is. */
export async function GET(request: NextRequest) {
  if (rateLimited(`requests-get:${clientIp(request)}`, 300, 60_000)) return NextResponse.json({ ok: false }, { status: 429 });
  const code = request.nextUrl.searchParams.get('code');
  const ticket = request.nextUrl.searchParams.get('ticket');
  if (!isValidEventCode(code) || !ticket) return NextResponse.json({ ok: false }, { status: 400 });
  const player = await findPlayerByTicket(code, ticket);
  if (!player) return NextResponse.json({ ok: false }, { status: 404 });
  return NextResponse.json({ ok: true, requests: await listGameRequests(code, player.id) }, { headers: { 'Cache-Control': 'no-store' } });
}

/** Ask for a game, take the request back, or promise to bring it (and take the promise back). */
export async function POST(request: NextRequest) {
  if (rateLimited(`requests-post:${clientIp(request)}`, 60, 60_000)) return NextResponse.json({ ok: false }, { status: 429 });
  const body = await request.json().catch(() => null) as ({ code?: string; ticket?: string } & Partial<RequestAction>) | null;
  if (!body || !isValidEventCode(body.code) || typeof body.ticket !== 'string' || !body.ticket) return NextResponse.json({ ok: false }, { status: 400 });
  if (!['request', 'unrequest', 'claim', 'unclaim'].includes(body.action as string)) return NextResponse.json({ ok: false }, { status: 400 });
  const player = await findPlayerByTicket(body.code, body.ticket);
  if (!player) return NextResponse.json({ ok: false }, { status: 404 });
  const result = await applyRequestAction(body.code, player.id, body as RequestAction);
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}
