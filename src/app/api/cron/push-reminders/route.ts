import { NextRequest, NextResponse } from 'next/server';
import { syncTodaysEvents } from '@/lib/pushServer';

export const runtime = 'nodejs';

// Meant to be pinged every few minutes on event day by an external scheduler (the "15 minutes
// before" reminders are time-based, so something has to wake the server up). Same bearer secret as
// the other cron route. Apps that are open also trigger the same sync on their own after any action.
export async function GET(request: NextRequest) {
  // Refuse when the secret isn't configured: otherwise the expected value would be the literal "Bearer undefined"
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json(await syncTodaysEvents());
}
