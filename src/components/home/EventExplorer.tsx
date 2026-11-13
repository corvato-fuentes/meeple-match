'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import type { PublicEvent } from '@/lib/publicEvents';
import { sortCards, whenOf } from '@/lib/homeEvents';
import EventSummary from './EventSummary';
import type { PinnedEvent } from './EventMap';

// The map library is only downloaded, on the device, when someone opens the map
const EventMap = dynamic(() => import('./EventMap'), {
  ssr: false,
  loading: () => <div className='h-72 flex items-center justify-center text-sm text-gray-500 border border-gray-700 rounded-xl'>Cargando mapa…</div>,
});

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; events: PublicEvent[]; now: Date };
type View = 'list' | 'map';

const chip = (on: boolean) =>
  'px-3 py-1 rounded-full text-sm font-medium border ' + (on ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-700 text-gray-300 hover:bg-gray-800');

/**
 * Every event that is open to join and not over yet, as cards: flyer, name, day, hours, place, how many are in, and a way into it.
 * It can be seen as a list or on a map with a pin for each event that could be located; on the map the list stays underneath.
 * Organizers can leave their event out (in the event's settings). Whether an event is over is decided here, with the hours.
 */
export default function EventExplorer() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [view, setView] = useState<View>('list');
  const events = state.kind === 'ready' ? state.events : null;
  const pinned = useMemo(() => (events ?? []).filter((e): e is PinnedEvent => e.geo !== null), [events]);

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
      <div className='flex flex-wrap items-center gap-2'>
        <button onClick={() => setView('list')} aria-pressed={view === 'list'} className={chip(view === 'list')}>📋 Lista ({state.events.length})</button>
        <button onClick={() => setView('map')} aria-pressed={view === 'map'} className={chip(view === 'map')}>🗺️ Mapa ({pinned.length})</button>
      </div>
      {view === 'map' && (
        pinned.length > 0 ? (
          <>
            <EventMap events={pinned} />
            {pinned.length < state.events.length && (
              <p className='text-xs text-gray-500'>
                {state.events.length - pinned.length === 1 ? '1 evento no tiene' : `${state.events.length - pinned.length} eventos no tienen`} ubicación en el mapa: están en la lista de abajo.
              </p>
            )}
          </>
        ) : (
          <p className='text-sm text-gray-500 border border-gray-700 rounded-xl p-4 text-center'>Ningún evento tiene ubicación en el mapa todavía. Están en la lista de abajo.</p>
        )
      )}
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
                📍 Abrir en Google Maps
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
