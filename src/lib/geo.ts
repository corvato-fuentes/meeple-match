import type { EventGeo, MeepleEvent } from './types';

export interface LatLng {
  lat: number;
  lng: number;
}

const inRange = (lat: number, lng: number): boolean =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

// The shapes a Google Maps address carries its coordinates in: "@lat,lng", "!3dlat!4dlng", or "?q=lat,lng" (also ll / query / destination)
const COORD_PATTERNS = [
  /@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,
  /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/,
  /[?&](?:q|ll|query|destination)=(-?\d{1,3}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)/i,
];

/** The coordinates written in a map address or page, or null when it carries none. */
export function coordsFromText(text: string): LatLng | null {
  for (const re of COORD_PATTERNS) {
    const m = text.match(re);
    if (m) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (inRange(lat, lng)) return { lat, lng };
    }
  }
  return null;
}

/**
 * Where the server may go to read a map link. The link is whatever the organizer typed, so following it blindly would let
 * anyone make the server fetch an internal address (SSRF): only https, only Google Maps' own hosts, no credentials, no
 * custom port. Every redirect it is sent to has to pass the same check.
 */
const MAP_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl', 'www.google.com', 'google.com', 'maps.google.com']);

export function isAllowedMapUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && MAP_HOSTS.has(u.hostname) && !u.username && !u.password && (u.port === '' || u.port === '443');
  } catch {
    return false;
  }
}

/** What an event's pin was worked out from: if the link or the place text changes, the pin has to be worked out again. */
export const geoKeyOf = (e: Pick<MeepleEvent, 'location' | 'mapUrl'>): string =>
  `${(e.mapUrl ?? '').trim()}|${(e.location ?? '').trim().toLowerCase()}`;

/**
 * What is already known about an event's pin: its coordinates, null when it was tried and nothing was found, or 'unknown' when it
 * has never been tried for the current link and place (or they changed since).
 */
export function knownGeo(e: Pick<MeepleEvent, 'location' | 'mapUrl' | 'geo'>): LatLng | null | 'unknown' {
  const g: EventGeo | undefined = e.geo;
  if (!g || g.key !== geoKeyOf(e)) return 'unknown';
  if ('failed' in g) return null;
  return inRange(g.lat, g.lng) ? { lat: g.lat, lng: g.lng } : null;
}
