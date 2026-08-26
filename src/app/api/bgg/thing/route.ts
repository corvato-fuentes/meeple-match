import { NextRequest, NextResponse } from 'next/server';
import type { GameComplexity } from '@/lib/types';

// Runs server-side to avoid BGG's XML API blocking direct browser CORS requests.
// Requires BGG_API_TOKEN (registered Application + Bearer token, see boardgamegeek.com/using_the_xml_api).
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  const token = process.env.BGG_API_TOKEN;
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });
  if (!token) return NextResponse.json({ error: 'BGG_API_TOKEN not configured' }, { status: 501 });

  const res = await fetch(`https://boardgamegeek.com/xmlapi2/thing?id=${encodeURIComponent(id)}&stats=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return NextResponse.json({ error: 'bgg request failed' }, { status: 502 });
  const xml = await res.text();

  const num = (tag: string, fallback: number) => {
    const m = new RegExp(`<${tag}[^>]*\\bvalue="([\\d.]+)"`).exec(xml);
    const n = m ? parseFloat(m[1]) : NaN;
    return Number.isFinite(n) ? n : fallback;
  };

  const weight = num('averageweight', 2);
  const complexity: GameComplexity = weight <= 1.8 ? 'light' : weight <= 3.3 ? 'medium' : 'heavy';

  return NextResponse.json({
    bggUrl: `https://boardgamegeek.com/boardgame/${id}`,
    minPlayers: Math.max(1, Math.round(num('minplayers', 2))),
    maxPlayers: Math.max(1, Math.round(num('maxplayers', 4))),
    durationMinutes: Math.max(10, Math.round(num('playingtime', 60))),
    complexity,
  });
}
