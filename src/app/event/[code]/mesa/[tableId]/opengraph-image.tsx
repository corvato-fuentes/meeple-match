import type { ReactNode } from 'react';
import { ImageResponse } from 'next/og';
import { getSharedTable } from '@/lib/shareTableServer';
import { dayLabel, sharePrompt } from '@/lib/shareTable';
import { fitInside, imageSize } from '@/lib/imageSize';

// The picture WhatsApp (and others) show with a shared table's link: the cover and what the table needs, as a card.
export const alt = 'Mesa compartida en Meeple Loop';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
// Seats change as people join: the card is made on every request, never served from an old copy
export const dynamic = 'force-dynamic';

// The cover URL comes from the game's own data, which players fill in: only fetch it from where BGG covers live
const COVER_HOSTS = /(^|\.)geekdo-images\.com$/;

// The card has 48px of margin; the cover takes the biggest area of it that its own proportions allow
const CARD_PADDING = 48;
const COVER_MAX = { width: 520, height: size.height - 2 * CARD_PADDING };

/** The cover as an inline image (the card renderer reads jpeg/png) with its size, or null when it can't be had quickly and safely. */
async function loadCover(url: string | null): Promise<{ uri: string; width: number; height: number } | null> {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !COVER_HOSTS.test(u.hostname)) return null;
    const res = await fetch(u, { signal: AbortSignal.timeout(4000) });
    const type = (res.headers.get('content-type') ?? '').split(';')[0];
    if (!res.ok || (type !== 'image/jpeg' && type !== 'image/png')) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > 3_000_000) return null;
    const dims = imageSize(bytes);
    if (!dims) return null;
    return { uri: `data:${type};base64,${Buffer.from(bytes).toString('base64')}`, ...fitInside(dims, COVER_MAX.width, COVER_MAX.height) };
  } catch {
    return null;
  }
}

// Icons are drawn here (the card renderer can't draw emoji): simple outlines in the app's violet. Grouped with <g>: it does not take React fragments
const ICON_PATHS: Record<'calendar' | 'clock' | 'pin', ReactNode> = {
  calendar: (
    <g>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </g>
  ),
  clock: (
    <g>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </g>
  ),
  pin: (
    <g>
      <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z" />
      <circle cx="12" cy="10" r="3" />
    </g>
  ),
};

function Row({ icon, fontSize, color, marginTop, children }: {
  icon: keyof typeof ICON_PATHS; fontSize: number; color: string; marginTop: number; children: ReactNode;
}) {
  const iconSize = Math.round(fontSize * 1.05);
  return (
    <div style={{ display: 'flex', alignItems: 'center', fontSize, color, marginTop }}>
      <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
        style={{ marginRight: 16, flexShrink: 0 }}>
        {ICON_PATHS[icon]}
      </svg>
      <div style={{ display: 'flex' }}>{children}</div>
    </div>
  );
}

export default async function Image({ params }: { params: Promise<{ code: string; tableId: string }> }) {
  const { code, tableId } = await params;
  const t = await getSharedTable(code, tableId).catch(() => null);
  const cover = t?.open ? await loadCover(t.imageUrl) : null;

  const shell = { display: 'flex', width: '100%', height: '100%', background: '#0b0f19', color: '#f3f4f6', padding: CARD_PADDING } as const;

  // No such table, or it is no longer open: the plain brand card
  if (!t || !t.open) {
    return new ImageResponse(
      (
        <div style={{ ...shell, flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ display: 'flex', fontSize: 84, color: '#818cf8' }}>Meeple Loop</div>
          <div style={{ display: 'flex', fontSize: 36, color: '#9ca3af', marginTop: 16 }}>Mesas de juegos de mesa para tu evento</div>
        </div>
      ),
      { ...size }
    );
  }

  const day = dayLabel(t.date);
  const dayText = day.charAt(0).toUpperCase() + day.slice(1);
  const nameSize = t.gameName.length > 34 ? 52 : t.gameName.length > 22 ? 64 : 76;
  return new ImageResponse(
    (
      <div style={shell}>
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover.uri} alt="" width={cover.width} height={cover.height} style={{ width: cover.width, height: cover.height, borderRadius: 20 }} />
        ) : (
          <div style={{ display: 'flex', width: 380, height: COVER_MAX.height, borderRadius: 24, background: '#1f2937', alignItems: 'center', justifyContent: 'center', fontSize: 40, color: '#6b7280' }}>
            Sin portada
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flex: 1, marginLeft: 52 }}>
          <div style={{ display: 'flex', fontSize: 28, color: '#818cf8', letterSpacing: 4 }}>MEEPLE LOOP</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', fontSize: 40, color: '#fbbf24' }}>{sharePrompt()}</div>
            <div style={{ display: 'flex', fontSize: nameSize, lineHeight: 1.1, marginTop: 12 }}>{t.gameName}</div>
            <Row icon="calendar" fontSize={36} color="#e5e7eb" marginTop={28}>{dayText}</Row>
            <Row icon="clock" fontSize={36} color="#e5e7eb" marginTop={10}>{t.startTime} – {t.endTime}</Row>
            {t.location && <Row icon="pin" fontSize={32} color="#9ca3af" marginTop={10}>{t.location}</Row>}
          </div>
          <div style={{ display: 'flex', fontSize: 28, color: '#9ca3af' }}>{t.eventName}</div>
        </div>
      </div>
    ),
    { ...size }
  );
}
