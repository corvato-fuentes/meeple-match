import { isAllowedMapUrl, type LatLng } from './geo';

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
  /** The place's own page on Google Maps, when there is one (better than a bare pin: it has photos and hours). Google links only. */
  mapUrl?: string;
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
    // The exact spot, from the place's page on Google Maps
    geo: { lat: -31.4141308, lng: -64.200024 },
    mapUrl:
      'https://www.google.com/maps/place/Casa+Hipa/@-31.4141308,-64.200024,17z/data=!3m1!4b1!4m6!3m5!1s0x9432999b8a8147db:0x1b6943a31ca74f6d!8m2!3d-31.4141308!4d-64.200024',
    schedules: [
      { days: 'Miércoles', time: '20:00 a 01:00 hs' },
      { days: 'Sábados', time: '20:00 a 01:00 hs' },
    ],
    whatsapp: '',
    instagram: 'casa.hipa',
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
    instagram: 'pesima.jugada',
  },
  {
    id: 'casa-del-ajedrez',
    name: 'Casa del Ajedrez',
    address: 'Nicolás Avellaneda 75',
    city: 'Córdoba',
    geo: { lat: -31.41166, lng: -64.19593 },
    schedules: [{ days: 'Lunes a viernes', time: '16:00 a 20:00 hs' }],
    whatsapp: '',
    instagram: 'casadeajedrez',
  },
  {
    id: '4-unico',
    name: '4.único',
    address: 'Av. Olmos 130, Galería Jardín',
    city: 'Córdoba',
    // The exact spot, from the place's page on Google Maps
    geo: { lat: -31.4142661, lng: -64.1813487 },
    mapUrl:
      'https://www.google.com/maps/place/Galer%C3%ADa+Jard%C3%ADn+%5BOlmos%5D/@-31.4137604,-64.186107,16z/data=!4m6!3m5!1s0x9432a29ce204265d:0xb45f55b599459eb1!8m2!3d-31.4142661!4d-64.1813487',
    schedules: [{ days: 'Lunes a sábados', time: '11:00 a 20:00 hs', note: 'Se reserva contactando al lugar' }],
    whatsapp: '',
    instagram: '4unico_juegos',
  },
  {
    id: 'noche-de-los-juegos-vidon-bar',
    name: 'Noche de los Juegos · Vidon Bar',
    address: 'Achával Rodríguez 152',
    city: 'Córdoba',
    geo: { lat: -31.42478, lng: -64.18997 },
    schedules: [{ days: 'Noches de juegos', time: 'Fecha variable', note: 'Se reserva por WhatsApp' }],
    whatsapp: '',
    instagram: 'lanochedelosjuegos',
  },
  {
    id: 'club-de-juegos-vcp',
    name: 'Club de juegos Villa Carlos Paz',
    address: null,
    city: 'Villa Carlos Paz',
    geo: { lat: -31.41838, lng: -64.4937 },
    schedules: [{ days: 'Domingos', time: '17:00 hs' }],
    whatsapp: '',
    instagram: 'clubdejuegosvcp',
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

/**
 * Google Maps link: the place's own page when it has one, else the pin. Nothing when there is no address
 * (the pin is only the city then, not worth opening).
 */
export function placeMapUrl(p: RecurringPlace): string | null {
  if (p.mapUrl && isAllowedMapUrl(p.mapUrl)) return p.mapUrl;
  return p.address ? `https://www.google.com/maps/search/?api=1&query=${p.geo.lat},${p.geo.lng}` : null;
}
