import { NextResponse } from 'next/server';
import { isValidEventCode, verifyMathTradeAdminTokenServer } from '@/lib/serverAuth';
import { rateLimited, clientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/** Math-trade admin check: the token can't be read from the browser anymore, so it is compared here. */
export async function POST(request: Request) {
  if (rateLimited(`auth-mathtrade:${clientIp(request)}`, 60, 60_000)) return NextResponse.json({ ok: false }, { status: 429 });
  const body = await request.json().catch(() => null) as { code?: string; adminToken?: string } | null;
  if (!body || !isValidEventCode(body.code) || typeof body.adminToken !== 'string') return NextResponse.json({ ok: false }, { status: 400 });
  const ok = await verifyMathTradeAdminTokenServer(body.code, body.adminToken);
  return NextResponse.json({ ok }, { status: ok ? 200 : 401 });
}
