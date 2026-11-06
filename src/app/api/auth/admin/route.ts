import { NextResponse } from 'next/server';
import { isValidEventCode, verifyAdminTokenServer, mintAdminToken } from '@/lib/serverAuth';
import { rateLimited, clientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Checks an event's secret admin token on the server and, if it matches, returns a Firebase custom token
 * carrying the `adminFor` claim — that claim is what the Firestore rules require for admin-only writes.
 */
export async function POST(request: Request) {
  if (rateLimited(`auth-admin:${clientIp(request)}`, 60, 60_000)) return NextResponse.json({ ok: false }, { status: 429 });
  const body = await request.json().catch(() => null) as { code?: string; adminToken?: string } | null;
  if (!body || !isValidEventCode(body.code) || typeof body.adminToken !== 'string') {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (!(await verifyAdminTokenServer(body.code, body.adminToken))) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true, customToken: await mintAdminToken(body.code) });
}
