import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { oldestDateToList, toPublicEvent, type PublicEvent } from '@/lib/publicEvents';
import { geoKeyOf, knownGeo, type LatLng } from '@/lib/geo';
import { resolveEventGeo } from '@/lib/geocodeServer';
import type { MeepleEvent } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Pins are worked out the first time an event is listed and then kept on the event (see EventGeo), so most calls look nothing up.
// A few at a time and never past a time budget, so one call can't drag: the rest are done by the next ones.
const MAX_LOOKUPS_PER_CALL = 2;
const LOOKUP_BUDGET_MS = 5000;
// Only the deployed app writes the pin to the database. Running locally it talks to the real database, so it just remembers
// the result in memory instead of touching real events.
const SAVE_PINS = process.env.NODE_ENV === 'production';
const pinsInMemory = new Map<string, LatLng | null>();

// The events listed in "Explorar eventos" on the home page. Public on purpose, so it returns only what the list shows
// (see PublicEvent): the event's name, day, hours, place, banner and pin, and how many are registered. The admin token, the
// payment data and the people never leave here.
export async function GET() {
  try {
    const now = new Date();
    const started = Date.now();
    const snap = await adminDb.collection('events').where('date', '>=', oldestDateToList(now)).get();
    const listable = snap.docs.filter((d) => toPublicEvent(d.id, d.data() as MeepleEvent, 0, now)); // decided before looking anything up

    // Pins, one event at a time (the place-name search allows one request a second)
    const pins = new Map<string, LatLng | null>();
    let lookups = 0;
    for (const d of listable) {
      const data = d.data() as MeepleEvent;
      const memoryKey = `${d.id}|${geoKeyOf(data)}`;
      let pin = knownGeo(data);
      if (pin === 'unknown' && !SAVE_PINS && pinsInMemory.has(memoryKey)) pin = pinsInMemory.get(memoryKey) ?? null;
      if (pin === 'unknown' && lookups < MAX_LOOKUPS_PER_CALL && Date.now() - started < LOOKUP_BUDGET_MS) {
        lookups++;
        const found = await resolveEventGeo(data);
        if (found !== 'error') { // when a service could not be reached nothing is remembered: it is tried again next time
          pin = found;
          if (SAVE_PINS) {
            const key = geoKeyOf(data);
            await d.ref.update({ geo: found ? { key, lat: found.lat, lng: found.lng } : { key, failed: true } }).catch(() => {});
          } else {
            pinsInMemory.set(memoryKey, found);
          }
        }
      }
      pins.set(d.id, pin === 'unknown' ? null : pin);
    }

    const events = await Promise.all(listable.map(async (d) => {
      const count = await d.ref.collection('players').count().get();
      return toPublicEvent(d.id, d.data() as MeepleEvent, count.data().count, now, pins.get(d.id) ?? null);
    }));
    const list = events.filter((e): e is PublicEvent => e !== null).sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
    return NextResponse.json({ events: list });
  } catch (err) {
    console.error('events/public', err);
    return NextResponse.json({ error: 'No se pudieron cargar los eventos' }, { status: 500 });
  }
}
