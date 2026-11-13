// Server only: works out where an event's pin goes. First from its Google Maps link (the organizer's own pin), then from the place
// text through OpenStreetMap's Nominatim. Nothing about people is sent anywhere: the link and the place text are already public.
import { coordsFromText, isAllowedMapUrl, type LatLng } from './geo';
import type { MeepleEvent } from './types';

// A generic client name, as Nominatim's usage policy asks (an identifiable app, no personal data)
const NOMINATIM_UA = 'MeepleLoop/1.0';
let lastNominatimAt = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Follows a (short) Google Maps link and reads the coordinates out of where it ends up. Only Google's own hosts are ever fetched. */
async function coordsFromMapLink(url: string): Promise<LatLng | null> {
  let cur = url;
  for (let hop = 0; hop < 5; hop++) {
    if (!isAllowedMapUrl(cur)) return null; // the first link and every redirect it sends us to
    const direct = coordsFromText(cur);
    if (direct) return direct;
    let res: Response;
    try {
      res = await fetch(cur, {
        redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MeepleLoop/1.0)' }, signal: AbortSignal.timeout(4000),
      });
    } catch {
      return null;
    }
    const location = res.headers.get('location');
    if (location) { cur = new URL(location, cur).toString(); continue; }
    if (!res.ok) return null;
    try {
      return coordsFromText((await res.text()).slice(0, 300_000));
    } catch {
      return null;
    }
  }
  return null;
}

/** One place-name search, at most one a second (Nominatim's limit). 'error' when it could not be asked, so it is tried again later. */
async function coordsFromPlaceName(place: string): Promise<LatLng | null | 'error'> {
  const wait = 1100 - (Date.now() - lastNominatimAt);
  if (wait > 0) await sleep(wait);
  lastNominatimAt = Date.now();
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(place)}`, {
      headers: { 'User-Agent': NOMINATIM_UA, 'Accept-Language': 'es' }, signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return 'error';
    const data = (await res.json()) as { lat?: string; lon?: string }[];
    const first = data[0];
    if (!first) return null;
    const lat = Number(first.lat);
    const lng = Number(first.lon);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  } catch {
    return 'error';
  }
}

/**
 * The coordinates for an event, or null when nothing was found (the link has none and the place text finds nothing), or 'error'
 * when a service could not be reached — in which case nothing should be remembered, so it is tried again.
 */
export async function resolveEventGeo(e: Pick<MeepleEvent, 'location' | 'mapUrl'>): Promise<LatLng | null | 'error'> {
  const link = (e.mapUrl ?? '').trim();
  if (link) {
    const fromLink = coordsFromText(link) ?? (isAllowedMapUrl(link) ? await coordsFromMapLink(link) : null);
    if (fromLink) return fromLink;
  }
  const place = (e.location ?? '').trim();
  if (place.length < 3) return null;
  return coordsFromPlaceName(place);
}
