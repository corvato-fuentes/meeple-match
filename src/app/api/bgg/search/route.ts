import { NextRequest, NextResponse } from 'next/server';

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

// Runs server-side to avoid BGG's XML API blocking direct browser CORS requests.
// BGG's XML API requires a registered Application + Bearer token (see boardgamegeek.com/using_the_xml_api).
// Without BGG_API_TOKEN configured, this silently returns no results so the UI just falls back to manual entry.
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q')?.trim();
  const token = process.env.BGG_API_TOKEN;
  if (!query || !token) return NextResponse.json({ results: [] });

  const res = await fetch(`https://boardgamegeek.com/xmlapi2/search?type=boardgame&query=${encodeURIComponent(query)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return NextResponse.json({ results: [] }, { status: 502 });
  const xml = await res.text();

  const results: { id: string; name: string; year: string | null }[] = [];
  const itemRegex = /<item[^>]*\bid="(\d+)"[^>]*>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(xml)) && results.length < 8) {
    const [, id, body] = match;
    const nameMatch = /<name[^>]*\bvalue="([^"]*)"/.exec(body);
    const yearMatch = /<yearpublished[^>]*\bvalue="([^"]*)"/.exec(body);
    if (nameMatch) {
      results.push({ id, name: decodeXmlEntities(nameMatch[1]), year: yearMatch?.[1] ?? null });
    }
  }
  return NextResponse.json({ results });
}
