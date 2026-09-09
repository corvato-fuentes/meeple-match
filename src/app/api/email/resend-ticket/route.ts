import { NextRequest, NextResponse } from 'next/server';
import { getEvent, verifyAdminToken, getPlayers } from '@/lib/firestore';
import { getEmailConfig } from '@/lib/emailConfigAdmin';
import { sendTicketEmail } from '@/lib/email';

// Admin-only: resends the ticket-code email to a single player.
export async function POST(request: NextRequest) {
  const { code, adminToken, playerId } = await request.json();
  if (!code || !adminToken || !playerId) return NextResponse.json({ error: 'Missing params' }, { status: 400 });

  const ok = await verifyAdminToken(code, adminToken);
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [event, players, emailConfig] = await Promise.all([getEvent(code), getPlayers(code), getEmailConfig(code)]);
  const player = players.find((p) => p.id === playerId);
  if (!event || !player) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!player.email) return NextResponse.json({ sent: false, reason: 'no-email' });

  const ticketUrl = `${request.nextUrl.origin}/event/${code}/me?ticket=${player.ticketCode}`;
  await sendTicketEmail({
    to: player.email, playerName: player.name, eventName: event.name,
    eventDate: event.date, eventLocation: event.location, ticketCode: player.ticketCode, ticketUrl,
    gmailUser: emailConfig?.gmailUser, gmailAppPassword: emailConfig?.gmailAppPassword,
  });
  return NextResponse.json({ sent: true });
}
