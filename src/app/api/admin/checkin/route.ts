import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { checkAdminToken } from '@/lib/adminTokenServer';
import { isValidEventCode } from '@/lib/pushServer';
import { rateLimited, clientIp } from '@/lib/rateLimit';
import { listAttendance, findPlayerByTicket, checkIn, undoCheckIn, previewPlayer } from '@/lib/checkinServer';

export const runtime = 'nodejs';

/** Admin only: every player with their arrival, to run the door. */
export async function GET(request: NextRequest) {
  if (rateLimited(`checkin-get:${clientIp(request)}`, 120, 60_000)) return NextResponse.json({ ok: false }, { status: 429 });
  const code = request.nextUrl.searchParams.get('code');
  if (!isValidEventCode(code) || !(await checkAdminToken(code, request.nextUrl.searchParams.get('adminToken')))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const players = await listAttendance(code);
  return NextResponse.json({ ok: true, players, arrived: players.filter((p) => p.checkedInAt != null).length, total: players.length },
    { headers: { 'Cache-Control': 'no-store' } });
}

/**
 * Admin only. Checks a player in — by scanned/typed ticket code or by player id (the list's buttons) — or, with
 * `undo`, takes the check-in back. Checking in someone who already arrived keeps their original time.
 */
export async function POST(request: NextRequest) {
  if (rateLimited(`checkin-post:${clientIp(request)}`, 240, 60_000)) return NextResponse.json({ ok: false }, { status: 429 });
  const body = await request.json().catch(() => null) as
    { code?: string; adminToken?: string; ticketCode?: string; playerId?: string; undo?: boolean; preview?: boolean } | null;
  if (!body || !isValidEventCode(body.code)) return NextResponse.json({ ok: false }, { status: 400 });
  if (!(await checkAdminToken(body.code, body.adminToken))) return NextResponse.json({ ok: false }, { status: 401 });

  // Events that ask for a payment proof: the door looks at the proof first and then decides, so this only reads.
  if (body.preview) {
    const player = await previewPlayer(body.code, { ticketCode: body.ticketCode, playerId: body.playerId });
    if (!player) return NextResponse.json({ ok: false, reason: 'unknown-player' }, { status: 404 });
    return NextResponse.json({ ok: true, player }, { headers: { 'Cache-Control': 'no-store' } });
  }

  let player: { id: string; name: string } | null = null;
  if (typeof body.ticketCode === 'string' && body.ticketCode.trim()) {
    player = await findPlayerByTicket(body.code, body.ticketCode);
  } else if (typeof body.playerId === 'string' && body.playerId) {
    const snap = await adminDb.doc(`events/${body.code}/players/${body.playerId}`).get();
    if (snap.exists) player = { id: snap.id, name: (snap.data()!.name as string) ?? '' };
  }
  if (!player) return NextResponse.json({ ok: false, reason: 'unknown-player' }, { status: 404 });

  if (body.undo) {
    await undoCheckIn(body.code, player.id);
    return NextResponse.json({ ok: true, player, undone: true });
  }
  const { at, already } = await checkIn(body.code, player.id);
  return NextResponse.json({ ok: true, player, at, already });
}
