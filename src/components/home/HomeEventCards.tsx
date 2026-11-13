'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getEvent } from '@/lib/firestore';
import { getBareTickets, getMyEvents, getMyPlayerEvents, hideFromHome, removeMyEvent, removeMyPlayerEvent } from '@/lib/myEvents';
import { mergeSavedEvents, sortCards, whenOf, type HomeEventCard } from '@/lib/homeEvents';
import type { MeepleEvent } from '@/lib/types';
import EventSummary from './EventSummary';

/** What reading an event gave: the event, `null` when it no longer exists, or `'offline'` when it could not be read. */
type Live = MeepleEvent | null | 'offline';
type Shown = HomeEventCard & { bannerUrl: string | null };

/**
 * The events this device already knows about — the ones the person organizes and the ones they have a ticket for — as cards:
 * flyer, name, day, hours, place, how far away it is, and the way back in (their ticket, their admin panel). Nothing is shown when
 * there are none. Each card appears once its event has been read (so one that no longer exists never flashes), with the event as it
 * is now; if it can't be read (no connection) it shows what the device saved.
 */
export default function HomeEventCards() {
  const [cards, setCards] = useState<HomeEventCard[]>([]);
  const [live, setLive] = useState<Record<string, Live>>({});
  const [now, setNow] = useState<Date | null>(null);

  // What this browser remembers can't be known during the server render
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const saved = mergeSavedEvents(getMyEvents(), getMyPlayerEvents(), getBareTickets());
      setCards(saved);
      setNow(new Date());
      saved.forEach((c) => {
        const set = (v: Live) => { if (!cancelled) setLive((l) => ({ ...l, [c.code]: v })); };
        getEvent(c.code).then(set).catch(() => set('offline'));
      });
    });
    return () => { cancelled = true; };
  }, []);

  function forget(code: string) {
    removeMyEvent(code);
    removeMyPlayerEvent(code);
    hideFromHome(code);
    setCards((cs) => cs.filter((c) => c.code !== code));
  }

  if (cards.length === 0 || !now) return null;
  const view = cards.flatMap((c): Shown[] => {
    const ev = live[c.code];
    if (ev === undefined || ev === null) return []; // not read yet, or it no longer exists
    if (ev === 'offline') return c.name ? [{ ...c, bannerUrl: null }] : []; // what the device saved, if it saved anything
    return [{
      ...c, name: ev.name, date: ev.date, startTime: ev.startTime, endTime: ev.endTime, location: ev.location,
      bannerUrl: ev.settings?.registrationBannerUrl ?? null,
    }];
  });
  if (view.length === 0) return null;

  return (
    <section className='space-y-3 text-left'>
      <h2 className='text-sm font-semibold text-gray-400 uppercase tracking-wide'>Tus eventos</h2>
      <div className='space-y-3'>
        {sortCards(view, now).map((c) => {
          const when = whenOf(c, now);
          return (
            <div key={c.code} className={'border border-gray-700 rounded-2xl p-4 bg-gray-800 ' + (when.tone === 'past' ? 'opacity-70' : '')}>
              <EventSummary name={c.name || c.code} bannerUrl={c.bannerUrl} date={c.date} startTime={c.startTime} endTime={c.endTime}
                location={c.location} when={when} />
              <div className='flex flex-wrap items-center gap-2 mt-3'>
                {c.ticket && (
                  <Link href={`/event/${c.code}/me?ticket=${c.ticket.ticketCode}`}
                    className='bg-indigo-600 text-white rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-indigo-700'>
                    🎟️ Mi ticket
                  </Link>
                )}
                {c.admin && (
                  <Link href={`/admin/${c.code}/${c.admin.adminToken}`}
                    className='border border-amber-700 text-amber-300 rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-amber-950/40'>
                    🛠️ Panel de organizador
                  </Link>
                )}
                <button onClick={() => forget(c.code)} title='Quitar de esta lista (no borra el evento ni tu inscripción)'
                  className='ml-auto text-xs text-gray-500 hover:text-gray-300'>
                  Quitar
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
