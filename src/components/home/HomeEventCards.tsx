'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getEvent } from '@/lib/firestore';
import { getMyEvents, getMyPlayerEvents, removeMyEvent, removeMyPlayerEvent } from '@/lib/myEvents';
import { mergeSavedEvents, sortCards, whenOf, type HomeEventCard, type WhenTone } from '@/lib/homeEvents';
import { dayLabel } from '@/lib/shareTable';
import type { MeepleEvent } from '@/lib/types';

const TONE: Record<WhenTone, string> = {
  live: 'bg-green-900 text-green-300',
  soon: 'bg-amber-900 text-amber-300',
  later: 'bg-gray-700 text-gray-300',
  past: 'bg-gray-800 text-gray-500',
};

/**
 * The events this device already knows about — the ones the person organizes and the ones they have a ticket for — as cards:
 * name, day, hours, place, how far away it is, and the way back in (their ticket, their admin panel). Nothing is shown when
 * there are none. Data is read fresh from the event, with what the device saved as the fallback.
 */
export default function HomeEventCards() {
  const [cards, setCards] = useState<HomeEventCard[]>([]);
  const [live, setLive] = useState<Record<string, MeepleEvent | null>>({});
  const [now, setNow] = useState<Date | null>(null);

  // What this browser remembers can't be known during the server render
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const saved = mergeSavedEvents(getMyEvents(), getMyPlayerEvents());
      setCards(saved);
      setNow(new Date());
      saved.forEach((c) => {
        getEvent(c.code).then((ev) => { if (!cancelled) setLive((l) => ({ ...l, [c.code]: ev })); }).catch(() => {});
      });
    });
    return () => { cancelled = true; };
  }, []);

  function forget(code: string) {
    removeMyEvent(code);
    removeMyPlayerEvent(code);
    setCards((cs) => cs.filter((c) => c.code !== code));
  }

  if (cards.length === 0 || !now) return null;
  // The event as it is now (name, hours and place may have changed since it was saved)
  const view = cards.map((c) => {
    const ev = live[c.code];
    return { ...c, ...(ev ? { name: ev.name, date: ev.date, startTime: ev.startTime, endTime: ev.endTime, location: ev.location } : {}), gone: ev === null };
  });

  return (
    <section className='space-y-3 text-left'>
      <h2 className='text-sm font-semibold text-gray-400 uppercase tracking-wide'>Tus eventos</h2>
      <div className='space-y-3'>
        {sortCards(view, now).map((c) => {
          const when = whenOf(c, now);
          return (
            <div key={c.code} className={'border border-gray-700 rounded-2xl p-4 bg-gray-800 ' + (c.gone || when.tone === 'past' ? 'opacity-70' : '')}>
              <div className='flex items-start justify-between gap-3'>
                <p className='font-semibold leading-snug'>{c.name || c.code}</p>
                {!c.gone && when.label && <span className={'shrink-0 text-xs rounded-full px-2 py-0.5 ' + TONE[when.tone]}>{when.label}</span>}
              </div>
              {c.gone ? (
                <p className='text-xs text-gray-500 mt-1'>Este evento ya no está disponible.</p>
              ) : (
                <div className='mt-1 space-y-0.5 text-xs text-gray-400'>
                  <p>📅 {dayLabel(c.date)}{c.startTime && c.endTime ? ` · ${c.startTime}–${c.endTime}` : ''}</p>
                  {c.location && <p>📍 {c.location}</p>}
                </div>
              )}
              <div className='flex flex-wrap items-center gap-2 mt-3'>
                {!c.gone && c.ticket && (
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
