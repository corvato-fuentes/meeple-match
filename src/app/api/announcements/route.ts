import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { isValidEventCode } from '@/lib/pushServer';
import { rateLimited, clientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/** Public: the latest announcements of an event, shown on each player's ticket. Only the text and when it was sent. */
export async function GET(request: NextRequest) {
  if (rateLimited(`announcements:${clientIp(request)}`, 300, 60_000)) return NextResponse.json({ ok: false }, { status: 429 });
  const code = request.nextUrl.searchParams.get('code');
  if (!isValidEventCode(code)) return NextResponse.json({ ok: false }, { status: 400 });
  const snap = await adminDb.collection(`events/${code}/announcements`).orderBy('createdAt', 'desc').limit(3).get();
  return NextResponse.json(
    { ok: true, announcements: snap.docs.map((d) => ({ id: d.id, text: d.data().text as string, createdAt: d.data().createdAt as number })) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
