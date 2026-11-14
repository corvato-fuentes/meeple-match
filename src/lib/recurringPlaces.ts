import type { LatLng } from './geo';

/**
 * Places where people play board games every week, with no registration in the app: you just get in touch with them.
 * They are listed here by hand (they are not events with a date) and show up in the explorer and on the map.
 */
export type PlaceSchedule = {
  /** "Miércoles", "Lunes a viernes"… */
  days: string;
  /** "20:00 a 01:00 hs", "Horario variable"… */
  time: string;
  /** What is special about this day: free, complex games, ask first… */
  note?: string;
};

export type RecurringPlace = {
  id: string;
  name: string;
  /** Street and number. `null` when it has to be asked: the card says so and the pin is only the city. */
  address: string | null;
  city: string;
  /** Where the pin goes. Looked up once on OpenStreetMap and kept here, so the map never depends on a geocoder. */
  geo: LatLng;
  /** One entry per day they play: the card shows them as the options. */
  schedules: PlaceSchedule[];
  note?: string;
  /**
   * WhatsApp contact: the number (country code + area code, digits only, e.g. 549351XXXXXXX) or the link of the chat / group
   * (https://wa.me/… or https://chat.whatsapp.com/…). Leave it empty and the icon is not shown.
   */
  whatsapp?: string;
  /** Instagram profile: the user name (with or without the @) or the link to the profile. Leave it empty and the icon is not shown. */
  instagram?: string;
};

// The contacts (`whatsapp`, `instagram`) are meant to be filled in by whoever maintains this file, straight here:
// the icons appear on the card and in the map as soon as there is a value.
export const RECURRING_PLACES: RecurringPlace[] = [
  {
    id: 'casa-hipa',
    name: 'Casa Hipa',
    address: 'Paso de los Andes 222',
    city: 'Córdoba',
    geo: { lat: -31.41417, lng: -64.19992 },
    schedules: [
      { days: 'Miércoles', time: '20:00 a 01:00 hs' },
      { days: 'Sábados', time: '20:00 a 01:00 hs' },
    ],
    whatsapp: '',
    instagram: '',
  },
  {
    id: 'pesima-jugada',
    name: 'Pésima Jugada',
    address: 'Nicolás Avellaneda 36',
    city: 'Córdoba',
    geo: { lat: -31.41204, lng: -64.19594 },
    schedules: [
      { days: 'Viernes', time: '17:00 a 21:00 hs', note: 'Juego libre y gratuito, sin inscripción' },
      { days: 'Miércoles', time: 'Horario variable', note: 'Juegos complejos: consultar el horario' },
    ],
    whatsapp: '',
    instagram: '',
  },
  {
    id: 'casa-del-ajedrez',
    name: 'Casa del Ajedrez',
    address: 'Nicolás Avellaneda 75',
    city: 'Córdoba',
    geo: { lat: -31.41166, lng: -64.19593 },
    schedules: [{ days: 'Lunes a viernes', time: '16:00 a 20:00 hs' }],
    whatsapp: '',
    instagram: '',
  },
  {
    id: '4-unico',
    name: '4.único',
    address: 'Av. Olmos 130, Galería Jardín',
    city: 'Córdoba',
    geo: { lat: -31.41431, lng: -64.18132 },
    schedules: [{ days: 'Lunes a sábados', time: '11:00 a 20:00 hs', note: 'Se reserva contactando al lugar' }],
    whatsapp: '',
    instagram: '',
  },
  {
    id: 'noche-de-los-juegos-vidon-bar',
    name: 'Noche de los Juegos · Vidon Bar',
    address: 'Achával Rodríguez 152',
    city: 'Córdoba',
    geo: { lat: -31.42478, lng: -64.18997 },
    schedules: [{ days: 'Noches de juegos', time: 'Fecha variable', note: 'Se reserva por WhatsApp' }],
    whatsapp: '',
    instagram: '',
  },
  {
    id: 'club-de-juegos-vcp',
    name: 'Club de juegos Villa Carlos Paz',
    address: null,
    city: 'Villa Carlos Paz',
    geo: { lat: -31.41838, lng: -64.4937 },
    schedules: [{ days: 'Domingos', time: '17:00 hs' }],
    whatsapp: '',
    instagram: '',
  },
];

/** What the card and the pin say where the street address would go. */
export const placeAddressText = (p: RecurringPlace): string => (p.address ? `${p.address}, ${p.city}` : 'Consultar lugar');

const WHATSAPP_HOSTS = ['wa.me', 'chat.whatsapp.com', 'api.whatsapp.com'];
const INSTAGRAM_HOSTS = ['instagram.com', 'www.instagram.com'];

function safeUrl(raw: string, hosts: string[]): string | null {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && hosts.includes(u.hostname.toLowerCase()) ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Link that opens the WhatsApp chat (or group). Only WhatsApp's own hosts are accepted; `null` when there is nothing valid to link. */
export function whatsappLink(value: string | undefined): string | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return safeUrl(v, WHATSAPP_HOSTS);
  const digits = v.replace(/[\s()+-]/g, '');
  return /^\d{8,15}$/.test(digits) ? `https://wa.me/${digits}` : null;
}

/** Link to the Instagram profile. Only Instagram's own hosts are accepted; `null` when there is nothing valid to link. */
export function instagramLink(value: string | undefined): string | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return safeUrl(v, INSTAGRAM_HOSTS);
  const handle = v.replace(/^@/, '');
  return /^[A-Za-z0-9._]{1,30}$/.test(handle) ? `https://www.instagram.com/${handle}/` : null;
}

/** Google Maps link to the pin (only when there is an address: the one of the city is not worth opening). */
export const placeMapUrl = (p: RecurringPlace): string | null =>
  p.address ? `https://www.google.com/maps/search/?api=1&query=${p.geo.lat},${p.geo.lng}` : null;
