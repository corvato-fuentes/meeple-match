import { NextRequest, NextResponse } from 'next/server';
import { getEvent, verifyAdminToken, getPlayers } from '@/lib/firestore';
import { getEmailConfig } from '@/lib/emailConfigAdmin';
import { sendTicketEmail } from '@/lib/email';

// Admin-only: resends the ticket-code email to every player that has an email on file.
export async function POST(request: NextRequest) {
  const { code, adminToken } = await request.json();
  if (!code || !adminToken) return NextResponse.json({ error: 'Missing params' }, { status: 400 });

  const ok = await verifyAdminToken(code, adminToken);
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [event, players, emailConfig] = await Promise.all([getEvent(code), getPlayers(code), getEmailConfig(code)]);
  if (!event) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const withEmail = players.filter((p) => p.email);
  const origin = request.nextUrl.origin;
  let sent = 0;
  for (const p of withEmail) {
    try {
      await sendTicketEmail({
        to: p.email!, playerName: p.name, eventName: event.name,
        eventDate: event.date, eventLocation: event.location, ticketCode: p.ticketCode,
        ticketUrl: `${origin}/event/${code}/me?ticket=${p.ticketCode}`,
        gmailUser: emailConfig?.gmailUser, gmailAppPassword: emailConfig?.gmailAppPassword,
      });
      sent++;
    } catch (err) {
      console.error(`No se pudo mandar el mail a ${p.email}`, err);
    }
  }
  return NextResponse.json({ sent, total: withEmail.length });
}
