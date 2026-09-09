import { NextRequest, NextResponse } from 'next/server';
import { getEvent, getPlayerByTicketCode } from '@/lib/firestore';
import { getEmailConfig } from '@/lib/emailConfigAdmin';
import { sendTicketEmail } from '@/lib/email';

// Called right after registration — no admin auth needed, the ticketCode was just generated for this player.
export async function POST(request: NextRequest) {
  const { code, ticketCode } = await request.json();
  if (!code || !ticketCode) return NextResponse.json({ error: 'Missing params' }, { status: 400 });

  const [event, player, emailConfig] = await Promise.all([
    getEvent(code), getPlayerByTicketCode(code, ticketCode), getEmailConfig(code),
  ]);
  if (!event || !player) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!player.email) return NextResponse.json({ sent: false, reason: 'no-email' });

  const ticketUrl = `${request.nextUrl.origin}/event/${code}/me?ticket=${ticketCode}`;
  await sendTicketEmail({
    to: player.email, playerName: player.name, eventName: event.name,
    eventDate: event.date, eventLocation: event.location, ticketCode, ticketUrl,
    gmailUser: emailConfig?.gmailUser, gmailAppPassword: emailConfig?.gmailAppPassword,
  });
  return NextResponse.json({ sent: true });
}
