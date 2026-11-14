'use client';
import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import type { PublicEvent } from '@/lib/publicEvents';
import type { LatLng } from '@/lib/geo';
import { dayLabel } from '@/lib/shareTable';
import { instagramLink, placeAddressText, whatsappLink, type RecurringPlace } from '@/lib/recurringPlaces';

export type PinnedEvent = PublicEvent & { geo: LatLng };

// The pins: drawn in CSS, so there are no image files to load (the usual Leaflet marker images break under bundlers)
const pinHtml = (color: string, emoji: string) =>
  `<div style="width:34px;height:34px;border-radius:50%;background:${color};border:2px solid #fff;display:flex;align-items:center;` +
  `justify-content:center;font-size:17px;box-shadow:0 1px 5px rgba(0,0,0,.55)">${emoji}</div>`;
const EVENT_PIN_HTML = pinHtml('#4f46e5', '🎲'); // events with a date: indigo
const PLACE_PIN_HTML = pinHtml('#0d9488', '🏠'); // places where people play every week: teal

/** A line of a popup. Built with textContent, never as HTML: names and places are typed by whoever organizes. */
function lineIn(box: HTMLElement, text: string, style = '') {
  const p = document.createElement('div');
  p.textContent = text;
  p.style.cssText = style;
  box.appendChild(p);
}

const newBox = () => {
  const box = document.createElement('div');
  box.style.cssText = 'min-width:160px;font:13px/1.35 system-ui,sans-serif;color:#111827';
  return box;
};

function linkIn(box: HTMLElement, href: string, text: string, style: string, external = false) {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = text;
  a.style.cssText = style;
  if (external) {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  }
  box.appendChild(a);
  return a;
}

/** What an event's pin opens. */
function popupFor(e: PinnedEvent): HTMLElement {
  const box = newBox();
  lineIn(box, e.name, 'font-weight:700;font-size:14px;margin-bottom:2px');
  lineIn(box, `📅 ${dayLabel(e.date)}${e.startTime && e.endTime ? ` · ${e.startTime}–${e.endTime}` : ''}`);
  if (e.location) lineIn(box, `📍 ${e.location}`);
  lineIn(box, e.players === 1 ? '👥 1 inscripto' : `👥 ${e.players} inscriptos`);
  linkIn(box, `/event/${encodeURIComponent(e.code)}`, 'Ver evento →', 'display:inline-block;margin-top:6px;color:#4338ca;font-weight:600;text-decoration:none');
  return box;
}

/** What a place's pin opens: its days and hours, where it is, and how to get in touch (no registration in the app). */
function popupForPlace(p: RecurringPlace): HTMLElement {
  const box = newBox();
  lineIn(box, p.name, 'font-weight:700;font-size:14px;margin-bottom:2px');
  lineIn(box, '🔁 Se juega siempre', 'color:#0f766e;font-size:12px;font-weight:600');
  lineIn(box, `📍 ${placeAddressText(p)}`, 'margin-top:2px');
  for (const s of p.schedules) {
    lineIn(box, `📅 ${s.days} · ${s.time}`, 'margin-top:3px');
    if (s.note) lineIn(box, s.note, 'font-size:12px;color:#4b5563;padding-left:20px');
  }
  if (p.note) lineIn(box, p.note, 'font-size:12px;color:#4b5563;margin-top:3px');
  const wa = whatsappLink(p.whatsapp);
  const ig = instagramLink(p.instagram);
  if (wa || ig) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:12px;margin-top:6px';
    const style = 'color:#4338ca;font-weight:600;text-decoration:none';
    if (wa) linkIn(row, wa, '💬 WhatsApp', style, true);
    if (ig) linkIn(row, ig, '📷 Instagram', style, true);
    box.appendChild(row);
  }
  lineIn(box, 'Sin inscripción en la app', 'font-size:11px;color:#6b7280;margin-top:4px');
  return box;
}

/**
 * The events that have a pin, and the places where people play every week, on an OpenStreetMap map.
 * Leaflet is loaded here, on the device and only when the map is opened. Scrolling the page does not zoom the map (the wheel stays the page's).
 */
export default function EventMap({ events, places = [] }: { events: PinnedEvent[]; places?: RecurringPlace[] }) {
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
      const iconOf = (html: string) => L.divIcon({ className: '', html, iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -18] });
      const eventIcon = iconOf(EVENT_PIN_HTML);
      const placeIcon = iconOf(PLACE_PIN_HTML);
      const markers = [
        ...places.map((p) => L.marker([p.geo.lat, p.geo.lng], { icon: placeIcon, title: p.name, riseOnHover: true }).bindPopup(popupForPlace(p)).addTo(map!)),
        // events last: when a place and an event share the spot, the one with a date is on top
        ...events.map((e) => L.marker([e.geo.lat, e.geo.lng], { icon: eventIcon, title: e.name, riseOnHover: true }).bindPopup(popupFor(e)).addTo(map!)),
      ];
      if (markers.length === 1) map.setView(markers[0].getLatLng(), 15);
      else map.fitBounds(L.featureGroup(markers).getBounds().pad(0.25));
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [events, places]);

  // `isolate`: Leaflet's panes have z-indexes of their own; kept inside the map they can't end up over the app's dialogs
  return <div ref={el} className='isolate h-72 w-full rounded-xl overflow-hidden border border-gray-700 bg-gray-900' />;
}
