import { NextResponse } from 'next/server';
import { notifyProofUploaded, isValidEventCode } from '@/lib/pushServer';
import { rateLimited, clientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Called by the app right after someone who registered as "indeciso" sends the receipt, to let the organizers know.
 * It trusts nothing from the caller beyond the ticket: the recipients and the text come from the stored event, and it only
 * ever notifies once per player.
 */
export async function POST(request: Request) {
  if (rateLimited(`proof:${clientIp(request)}`, 60, 60_000)) return NextResponse.json({ ok: false }, { status: 429 });
  const body = await request.json().catch(() => null) as { code?: string; ticketCode?: string } | null;
  if (!body || !isValidEventCode(body.code) || typeof body.ticketCode !== 'string' || body.ticketCode.length > 20) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  try {
    const { devices } = await notifyProofUploaded(body.code, body.ticketCode);
    return NextResponse.json({ ok: true, devices });
  } catch (err) {
    console.error('[push] proof notice failed', err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
