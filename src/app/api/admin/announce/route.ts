import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { checkAdminToken } from '@/lib/adminTokenServer';
import { broadcastToEvent, isValidEventCode } from '@/lib/pushServer';
import { rateLimited, clientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';

const MAX_LENGTH = 200;
const MIN_GAP_MS = 20_000; // one announcement every 20 seconds per event, however many instances answer
const announcements = (code: string) => adminDb.collection(`events/${code}/announcements`);

/** Admin only: how many devices would get an announcement, plus the recent ones sent. */
export async function GET(request: NextRequest) {
  if (rateLimited(`announce-get:${clientIp(request)}`, 60, 60_000)) return NextResponse.json({ ok: false }, { status: 429 });
  const code = request.nextUrl.searchParams.get('code');
  if (!isValidEventCode(code) || !(await checkAdminToken(code, request.nextUrl.searchParams.get('adminToken')))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const [subs, recent] = await Promise.all([
    adminDb.collection(`events/${code}/pushSubs`).get(),
    announcements(code).orderBy('createdAt', 'desc').limit(5).get(),
  ]);
  return NextResponse.json({
    ok: true,
    devices: subs.size,
    players: new Set(subs.docs.map((d) => d.data().playerId)).size,
    recent: recent.docs.map((d) => ({ id: d.id, ...(d.data() as { text: string; createdAt: number; sentDevices?: number }) })),
  });
}

/**
 * Admin only: sends a message to everyone. It is pushed to every device with notifications on, and it is stored so
 * the ticket page shows it too (people without notifications still see it when they open the app).
 */
export async function POST(request: NextRequest) {
  if (rateLimited(`announce-post:${clientIp(request)}`, 20, 60_000)) return NextResponse.json({ ok: false }, { status: 429 });
  const body = await request.json().catch(() => null) as { code?: string; adminToken?: string; text?: string } | null;
  if (!body || !isValidEventCode(body.code) || typeof body.text !== 'string') return NextResponse.json({ ok: false }, { status: 400 });
  if (!(await checkAdminToken(body.code, body.adminToken))) return NextResponse.json({ ok: false }, { status: 401 });

  const text = body.text.replace(/\s+/g, ' ').trim();
  if (!text || text.length > MAX_LENGTH) return NextResponse.json({ ok: false, reason: 'bad-text' }, { status: 400 });

  const last = await announcements(body.code).orderBy('createdAt', 'desc').limit(1).get();
  if (!last.empty && Date.now() - (last.docs[0].data().createdAt as number) < MIN_GAP_MS) {
    return NextResponse.json({ ok: false, reason: 'too-soon' }, { status: 429 });
  }

  const eventName = ((await adminDb.doc(`events/${body.code}`).get()).data()?.name as string | undefined) ?? 'Meeple Loop';
  const doc = await announcements(body.code).add({ text, createdAt: Date.now() });
  const { devices, players } = await broadcastToEvent(body.code, { title: `📣 ${eventName}`, body: text, tag: `announce-${body.code}`, ttl: 3600 });
  await doc.update({ sentDevices: devices, sentPlayers: players });
  return NextResponse.json({ ok: true, id: doc.id, devices, players });
}
