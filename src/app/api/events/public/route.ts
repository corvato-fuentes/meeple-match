import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { oldestDateToList, toPublicEvent, type PublicEvent } from '@/lib/publicEvents';
import type { MeepleEvent } from '@/lib/types';

export const dynamic = 'force-dynamic';

// The events listed in "Explorar eventos" on the home page. Public on purpose, so it returns only what the list shows
// (see PublicEvent): the event's name, day, hours, place and banner, and how many are registered. The admin token, the
// payment data and the people never leave here.
export async function GET() {
  try {
    const now = new Date();
    const snap = await adminDb.collection('events').where('date', '>=', oldestDateToList(now)).get();
    const events = await Promise.all(snap.docs.map(async (d) => {
      const data = d.data() as MeepleEvent;
      if (!toPublicEvent(d.id, data, 0, now)) return null; // decided before counting anyone
      const count = await d.ref.collection('players').count().get();
      return toPublicEvent(d.id, data, count.data().count, now);
    }));
    const list = events.filter((e): e is PublicEvent => e !== null).sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
    return NextResponse.json({ events: list });
  } catch (err) {
    console.error('events/public', err);
    return NextResponse.json({ error: 'No se pudieron cargar los eventos' }, { status: 500 });
  }
}
