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
  // <image>/<thumbnail> are plain text elements (not attributes like the tags above)
  const str = (tag: string): string | null => {
    const m = new RegExp(`<${tag}>([^<]*)<\\/${tag}>`).exec(xml);
    return m ? m[1].trim() || null : null;
  };

  const weight = num('averageweight', 2);
  const complexity: GameComplexity = weight <= 1.8 ? 'light' : weight <= 3.3 ? 'medium' : 'heavy';

  // BGG's own community poll (per-count Best/Recommended/Not Recommended votes) reflects how people
  // actually play it — often narrower than the box-stated <minplayers>/<maxplayers>, which is just
  // the publisher's claim. A player count is "usable" here if Not Recommended isn't its plurality
  // vote, and we always drop 1-player counts regardless of votes — this app matches players into
  // shared tables, so a solo-only recommendation isn't a table we can ever fill. Falls back to the
  // box numbers when a game has no/too-thin poll data.
  const boxMaxPlayers = Math.max(1, Math.round(num('maxplayers', 4)));
  let minPlayers = Math.max(1, Math.round(num('minplayers', 2)));
  let maxPlayers = boxMaxPlayers;
  const pollMatch = /<poll name="suggested_numplayers"[^>]*>([\s\S]*?)<\/poll>/.exec(xml);
  if (pollMatch) {
    const usableCounts: number[] = [];
    const resultsRegex = /<results numplayers="(\d+)">([\s\S]*?)<\/results>/g;
    let resultsMatch: RegExpExecArray | null;
    while ((resultsMatch = resultsRegex.exec(pollMatch[1]))) {
      const n = parseInt(resultsMatch[1], 10);
      if (n < 2) continue;
      const block = resultsMatch[2];
      const votes = (value: string) => {
        const m = new RegExp(`value="${value}" numvotes="(\\d+)"`).exec(block);
        return m ? parseInt(m[1], 10) : 0;
      };
      const best = votes('Best');
      const recommended = votes('Recommended');
      const notRecommended = votes('Not Recommended');
      if (best + recommended + notRecommended === 0) continue;
      if (notRecommended > best && notRecommended > recommended) continue;
      usableCounts.push(n);
    }
    if (usableCounts.length > 0) {
      minPlayers = Math.min(...usableCounts);
      maxPlayers = Math.max(...usableCounts);
    }
  }

  return NextResponse.json({
    bggUrl: `https://boardgamegeek.com/boardgame/${id}`,
    // Full-size <image> (not <thumbnail>, ~200px) since this fills a large portrait cover slot in the UI.
    imageUrl: str('image') ?? str('thumbnail'),
    minPlayers,
    maxPlayers,
    // The box's actual max capacity — kept separate from `maxPlayers` above (which may be the
    // narrower community "best with" range) since dividing total playtime by a "best with 1-2"
    // range wildly overstates per-player time for a game that can seat up to 4.
    boxMaxPlayers,
    durationMinutes: Math.max(10, Math.ceil(num('playingtime', 60) / 5) * 5),
    complexity,
  });
}
