import { NextResponse } from 'next/server';
import { buildManifest, isTicketStartUrl } from '@/lib/pwaManifest';

/**
 * Per-ticket web app manifest: the ticket page points its <link rel="manifest"> here so that
 * installing the app from a ticket makes the home-screen icon open that ticket directly (also on
 * iPhone, where an installed app doesn't share the browser's saved data).
 */
export async function GET(request: Request) {
  const start = new URL(request.url).searchParams.get('start') ?? '';
  const manifest = buildManifest(isTicketStartUrl(start) ? start : '/');
  return NextResponse.json(manifest, {
    headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=3600' },
  });
}
