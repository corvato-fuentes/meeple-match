import type { MetadataRoute } from 'next';

const THEME = '#030712'; // gray-950, same as the page background

/**
 * Web app manifest shared by the default `/manifest.webmanifest` and the per-ticket variant served
 * from `/api/manifest`. `id` is fixed, so every variant is the same installed app; only `start_url`
 * changes — a ticket page installs straight into that player's ticket.
 */
export function buildManifest(startUrl = '/'): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Meeple Loop',
    short_name: 'Meeple Loop',
    description: 'Tu ticket, tus mesas y los juegos del evento a un toque',
    lang: 'es',
    start_url: startUrl,
    scope: '/',
    display: 'standalone',
    background_color: THEME,
    theme_color: THEME,
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

/** Only ever allow a start URL that is a player's ticket page — never an arbitrary path or origin. */
export function isTicketStartUrl(value: string): boolean {
  return /^\/event\/[A-Za-z0-9]{3,12}\/me\?ticket=[A-Za-z0-9]{3,16}$/.test(value);
}
