'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import type { PublicEvent } from '@/lib/publicEvents';
import { sortCards, whenOf } from '@/lib/homeEvents';
import { RECURRING_PLACES } from '@/lib/recurringPlaces';
import EventSummary from './EventSummary';
import RecurringPlaceCard from './RecurringPlaceCard';
import { eventPinKey, placePinKey, type PinnedEvent } from './EventMap';

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
 * Every event or juntada that is open to join and not over yet, as cards: flyer, name, day, hours, place, how many are in, and a way into it.
 * After them, the places where people play every week (no registration in the app: a WhatsApp or Instagram to get in touch).
 * It can be seen as a list or on a map with a pin for each event that could be located and for each place: one view at a time.
 * Organizers can leave their event out (in the event's settings). Whether an event is over is decided here, with the hours.
 */
export default function EventExplorer() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [view, setView] = useState<View>('list');
  // The pin a card sent us to: the map opens with it in the middle (null: the usual first view)
  const [focus, setFocus] = useState<string | null>(null);
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

  if (state.kind === 'loading') return <p className='text-sm text-gray-500'>Buscando eventos y juntadas…</p>;
  if (state.kind === 'error') {
    return (
      <div className='text-sm space-y-2'>
        <p className='text-red-400'>No se pudieron cargar los eventos y juntadas. Revisá tu conexión.</p>
        <button onClick={load} className='text-indigo-400 hover:underline'>Intentar de nuevo</button>
      </div>
    );
  }

  const withoutPin = state.events.length - pinned.length;
  const showOnMap = (pinKey: string) => {
    setFocus(pinKey);
    setView('map');
    // the map is above the cards: bring it into view once it is there
    setTimeout(() => document.getElementById('explorer-map')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
  };

  return (
    <div className='space-y-3'>
      <div className='flex flex-wrap items-center gap-2'>
        <button onClick={() => { setFocus(null); setView('list'); }} aria-pressed={view === 'list'} className={chip(view === 'list')}>📋 Lista ({state.events.length + RECURRING_PLACES.length})</button>
        <button onClick={() => { setFocus(null); setView('map'); }} aria-pressed={view === 'map'} className={chip(view === 'map')}>🗺️ Mapa ({pinned.length + RECURRING_PLACES.length})</button>
      </div>
      {view === 'map' && (
        <>
          <div id='explorer-map'><EventMap events={pinned} places={RECURRING_PLACES} focus={focus} /></div>
          <p className='text-xs text-gray-500'>🎲 Eventos · 🏠 Juntadas en casa · 🏪 Lugares donde se juega siempre</p>
          {withoutPin > 0 && (
            <p className='text-xs text-gray-500'>
              {withoutPin === 1 ? '1 evento o juntada no tiene' : `${withoutPin} eventos y juntadas no tienen`} ubicación en el mapa: lo{withoutPin === 1 ? '' : 's'} ves en «Lista».
            </p>
          )}
        </>
      )}
      {/* The map and the list are two views of the same events: one at a time */}
      {view === 'list' && (
        <>
          {state.events.length === 0 && <p className='text-sm text-gray-500'>Todavía no hay eventos ni juntadas disponibles.</p>}
          {state.events.map((e) => (
            <div key={e.code} className='border border-gray-700 rounded-xl p-3 bg-gray-900'>
              {e.kind === 'meetup' && <span className='inline-block mb-2 text-xs px-2 py-0.5 rounded-full bg-amber-900/50 text-amber-300 border border-amber-700'>🏠 Juntada</span>}
              <EventSummary name={e.name} bannerUrl={e.bannerUrl} date={e.date} startTime={e.startTime} endTime={e.endTime}
                location={e.location} when={whenOf(e, state.now)}>
                <p>👥 {e.players === 1 ? '1 inscripto' : `${e.players} inscriptos`}</p>
              </EventSummary>
              <div className='flex flex-wrap items-center gap-3 mt-3'>
                <Link href={`/event/${e.code}`} className='bg-indigo-600 text-white rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-indigo-700'>
                  {e.kind === 'meetup' ? 'Ver juntada →' : 'Ver evento →'}
                </Link>
                {e.geo ? (
                  <button type='button' onClick={() => showOnMap(eventPinKey(e.code))} className='text-xs text-indigo-400 hover:underline'>
                    🗺️ Ver en el mapa
                  </button>
                ) : e.mapUrl && (
                  // no pin could be worked out for it: the link of the organizer is all there is
                  <a href={e.mapUrl} target='_blank' rel='noopener noreferrer' className='text-xs text-indigo-400 hover:underline'>
                    📍 Abrir en Google Maps
                  </a>
                )}
              </div>
            </div>
          ))}
          <div className='pt-2 space-y-3'>
            <div>
              <h3 className='text-sm font-semibold text-gray-200'>🔁 Lugares donde se juega siempre</h3>
              <p className='text-xs text-gray-500'>No hace falta inscribirse acá: escribile al lugar.</p>
            </div>
            {RECURRING_PLACES.map((p) => <RecurringPlaceCard key={p.id} place={p} onShowOnMap={(pl) => showOnMap(placePinKey(pl.id))} />)}
          </div>
        </>
      )}
    </div>
  );
}
