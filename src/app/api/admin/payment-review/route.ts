import { NextResponse } from 'next/server';
import { checkAdminToken } from '@/lib/adminTokenServer';
import { isValidEventCode } from '@/lib/pushServer';
import { reviewReceipt, remindReceipts } from '@/lib/paymentReviewServer';
import { rateLimited, clientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Admin only. What an organizer does about receipts:
 *  - approve / reject one player's receipt (a rejection tells the player to send a new one);
 *  - remind: ask for the receipt from one player, or from everyone who still owes it when no player is given.
 */
export async function POST(request: Request) {
  if (rateLimited(`review:${clientIp(request)}`, 120, 60_000)) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  const body = await request.json().catch(() => null) as { code?: string; adminToken?: string; action?: string; playerId?: string } | null;
  if (!body || !isValidEventCode(body.code)) return NextResponse.json({ error: 'Missing params' }, { status: 400 });
  if (!(await checkAdminToken(body.code, body.adminToken))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const playerId = typeof body.playerId === 'string' && body.playerId.length <= 64 ? body.playerId : undefined;
  try {
    if (body.action === 'approve' || body.action === 'reject') {
      if (!playerId) return NextResponse.json({ error: 'Missing player' }, { status: 400 });
      return NextResponse.json({ ok: true, ...(await reviewReceipt(body.code, playerId, body.action)) });
    }
    if (body.action === 'remind') return NextResponse.json({ ok: true, ...(await remindReceipts(body.code, playerId)) });
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    console.error('[payment-review] failed', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
