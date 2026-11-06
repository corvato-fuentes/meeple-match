import { NextResponse } from 'next/server';
import { removeSubscription, isValidEventCode } from '@/lib/pushServer';
import { rateLimited, clientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/** Removes one device's subscription — only ever the registration of the player owning `ticketCode`. */
export async function POST(request: Request) {
  if (rateLimited(`unsubscribe:${clientIp(request)}`, 20, 60_000)) return NextResponse.json({ ok: false }, { status: 429 });
  const body = await request.json().catch(() => null) as { code?: string; ticketCode?: string; endpoint?: string } | null;
  if (!body || !isValidEventCode(body.code) || typeof body.ticketCode !== 'string') {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  return NextResponse.json(await removeSubscription(body.code, body.ticketCode, body.endpoint));
}
