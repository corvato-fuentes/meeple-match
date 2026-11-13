import type { LatLng } from './geo';
import type { MeepleEvent } from './types';

/** What "Explorar eventos" shows of an event: the event itself and how many are in — never anyone's name or contact. */
export interface PublicEvent {
  code: string;
  name: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  mapUrl: string | null;
  bannerUrl: string | null;
  players: number;
  /** Where its pin goes on the map; null when it could not be located. */
  geo: LatLng | null;
}

/** Events are listed unless the organizer turned it off. */
export const isListed = (e: Pick<MeepleEvent, 'settings'>): boolean => e.settings?.listed !== false;

/** The app running on the developer's own machine (it still talks to the real database). */
export const isLocalhostName = (hostname: string): boolean => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);

/** What a new event does about the public list when the organizer has not chosen: listed, except when created from localhost (a test). */
export const listedByDefault = (onLocalhost: boolean): boolean => !onLocalhost;

/**
 * The oldest day (`YYYY-MM-DD`) still worth sending: yesterday. The server's clock is not the organizer's, so whether an event is
 * already over is decided on the device (with the hours); the server only drops what is clearly past.
 */
export function oldestDateToList(now: Date): string {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** The public view of an event doc; null when it must not be listed (turned off, or without a name or a day). */
export function toPublicEvent(code: string, e: MeepleEvent, players: number, now: Date, geo: LatLng | null = null): PublicEvent | null {
  if (!isListed(e) || !e.name || !e.date || e.date < oldestDateToList(now)) return null;
  return {
    code, name: e.name, date: e.date, startTime: e.startTime, endTime: e.endTime, location: e.location ?? '',
    mapUrl: e.mapUrl ?? null, bannerUrl: e.settings?.registrationBannerUrl ?? null, players, geo,
  };
}
