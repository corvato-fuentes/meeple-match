import { NextRequest, NextResponse } from 'next/server';
import { isValidEventCode } from '@/lib/pushServer';
import { rateLimited, clientIp } from '@/lib/rateLimit';
import { findPlayerByTicket, getCheckInTime } from '@/lib/checkinServer';

export const runtime = 'nodejs';

/** A player's own ticket asks whether it has been checked in yet (the ticket page shows "✅ Ya hiciste el check-in"). */
export async function GET(request: NextRequest) {
  if (rateLimited(`checkin-status:${clientIp(request)}`, 600, 60_000)) return NextResponse.json({ ok: false }, { status: 429 });
  const code = request.nextUrl.searchParams.get('code');
  const ticket = request.nextUrl.searchParams.get('ticket');
  if (!isValidEventCode(code) || !ticket) return NextResponse.json({ ok: false }, { status: 400 });
  const player = await findPlayerByTicket(code, ticket);
  if (!player) return NextResponse.json({ ok: false }, { status: 404 });
  return NextResponse.json({ ok: true, checkedInAt: await getCheckInTime(code, player.id) }, { headers: { 'Cache-Control': 'no-store' } });
}
