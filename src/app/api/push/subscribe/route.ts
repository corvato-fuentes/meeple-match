import { NextResponse } from 'next/server';
import { saveSubscription, isValidEventCode } from '@/lib/pushServer';
import { rateLimited, clientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/** Stores a device's push subscription for the player who owns `ticketCode`. */
export async function POST(request: Request) {
  if (rateLimited(`subscribe:${clientIp(request)}`, 20, 60_000)) return NextResponse.json({ ok: false, reason: 'rate-limited' }, { status: 429 });
  const body = await request.json().catch(() => null) as { code?: string; ticketCode?: string; subscription?: unknown } | null;
  if (!body || !isValidEventCode(body.code) || typeof body.ticketCode !== 'string') {
    return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
  }
  const result = await saveSubscription(body.code, body.ticketCode, body.subscription);
  return NextResponse.json(result, { status: result.ok ? 200 : result.reason === 'not-configured' ? 503 : 400 });
}
