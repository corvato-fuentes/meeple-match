'use client';
import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import type { PublicEvent } from '@/lib/publicEvents';
import type { LatLng } from '@/lib/geo';
import { dayLabel } from '@/lib/shareTable';

export type PinnedEvent = PublicEvent & { geo: LatLng };

// The pin: drawn in CSS, so there are no image files to load (the usual Leaflet marker images break under bundlers)
const PIN_HTML =
  '<div style="width:34px;height:34px;border-radius:50%;background:#4f46e5;border:2px solid #fff;display:flex;align-items:center;' +
  'justify-content:center;font-size:17px;box-shadow:0 1px 5px rgba(0,0,0,.55)">🎲</div>';

/** What a pin opens. Built with textContent, never as HTML: event names and places are typed by whoever organizes. */
function popupFor(e: PinnedEvent): HTMLElement {
  const box = document.createElement('div');
  box.style.cssText = 'min-width:160px;font:13px/1.35 system-ui,sans-serif;color:#111827';
  const line = (text: string, style = '') => {
    const p = document.createElement('div');
    p.textContent = text;
    p.style.cssText = style;
    box.appendChild(p);
  };
  line(e.name, 'font-weight:700;font-size:14px;margin-bottom:2px');
  line(`📅 ${dayLabel(e.date)}${e.startTime && e.endTime ? ` · ${e.startTime}–${e.endTime}` : ''}`);
  if (e.location) line(`📍 ${e.location}`);
  line(e.players === 1 ? '👥 1 inscripto' : `👥 ${e.players} inscriptos`);
  const a = document.createElement('a');
  a.href = `/event/${encodeURIComponent(e.code)}`;
  a.textContent = 'Ver evento →';
  a.style.cssText = 'display:inline-block;margin-top:6px;color:#4338ca;font-weight:600;text-decoration:none';
  box.appendChild(a);
  return box;
}

/**
 * The events that have a pin, on an OpenStreetMap map. Leaflet is loaded here, on the device and only when the map is opened.
 * Scrolling the page does not zoom the map (the wheel stays the page's).
 */
export default function EventMap({ events }: { events: PinnedEvent[] }) {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let map: import('leaflet').Map | null = null;
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !el.current) return;
      map = L.map(el.current, { scrollWheelZoom: false });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
      }).addTo(map);
      const icon = L.divIcon({ className: '', html: PIN_HTML, iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -18] });
      const markers = events.map((e) => L.marker([e.geo.lat, e.geo.lng], { icon, title: e.name }).bindPopup(popupFor(e)).addTo(map!));
      if (markers.length === 1) map.setView(markers[0].getLatLng(), 15);
      else map.fitBounds(L.featureGroup(markers).getBounds().pad(0.25));
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [events]);

  // `isolate`: Leaflet's panes have z-indexes of their own; kept inside the map they can't end up over the app's dialogs
  return <div ref={el} className='isolate h-72 w-full rounded-xl overflow-hidden border border-gray-700 bg-gray-900' />;
}
