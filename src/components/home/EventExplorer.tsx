'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { PublicEvent } from '@/lib/publicEvents';
import { sortCards, whenOf } from '@/lib/homeEvents';
import EventSummary from './EventSummary';

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; events: PublicEvent[]; now: Date };

/**
 * Every event that is open to join and not over yet, as cards: flyer, name, day, hours, place, how many are in, and a way into it.
 * Organizers can leave their event out (in the event's settings). Whether an event is over is decided here, with the hours.
 */
export default function EventExplorer() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const res = await fetch('/api/events/public', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const { events } = (await res.json()) as { events: PublicEvent[] };
      const now = new Date();
      setState({ kind: 'ready', events: sortCards(events.filter((e) => whenOf(e, now).tone !== 'past'), now), now });
    } catch {
      setState({ kind: 'error' });
    }
  }, []);

  useEffect(() => { queueMicrotask(load); }, [load]);

  if (state.kind === 'loading') return <p className='text-sm text-gray-500'>Buscando eventos…</p>;
  if (state.kind === 'error') {
    return (
      <div className='text-sm space-y-2'>
        <p className='text-red-400'>No se pudieron cargar los eventos. Revisá tu conexión.</p>
        <button onClick={load} className='text-indigo-400 hover:underline'>Intentar de nuevo</button>
      </div>
    );
  }
  if (state.events.length === 0) return <p className='text-sm text-gray-500'>Todavía no hay eventos disponibles.</p>;

  return (
    <div className='space-y-3'>
      {state.events.map((e) => (
        <div key={e.code} className='border border-gray-700 rounded-xl p-3 bg-gray-900'>
          <EventSummary name={e.name} bannerUrl={e.bannerUrl} date={e.date} startTime={e.startTime} endTime={e.endTime}
            location={e.location} when={whenOf(e, state.now)}>
            <p>👥 {e.players === 1 ? '1 inscripto' : `${e.players} inscriptos`}</p>
          </EventSummary>
          <div className='flex flex-wrap items-center gap-3 mt-3'>
            <Link href={`/event/${e.code}`} className='bg-indigo-600 text-white rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-indigo-700'>
              Ver evento →
            </Link>
            {e.mapUrl && (
              <a href={e.mapUrl} target='_blank' rel='noopener noreferrer' className='text-xs text-indigo-400 hover:underline'>
                📍 Ver en el mapa
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
