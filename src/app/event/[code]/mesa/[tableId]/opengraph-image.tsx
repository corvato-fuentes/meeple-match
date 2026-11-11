import { ImageResponse } from 'next/og';
import { getSharedTable } from '@/lib/shareTableServer';
import { dayLabel, sharePrompt } from '@/lib/shareTable';
import { IconRow, loadCover } from '@/lib/shareCardParts';

// The picture WhatsApp (and others) show with a shared table's link: the cover and what the table needs, as a card.
export const alt = 'Mesa compartida en Meeple Loop';
// Half of the usual 1200×630: the card is mostly the cover's artwork, which PNG compresses badly (about 750 KB at full size),
// and WhatsApp drops preview pictures much over 300 KB. Everything below is laid out on the 1200×630 grid and scaled by px().
const SCALE = 0.5;
export const size = { width: 600, height: 315 };
const px = (n: number) => Math.round(n * SCALE);
export const contentType = 'image/png';
// Seats change as people join: the card is made on every request, never served from an old copy
export const dynamic = 'force-dynamic';

// The card has a margin; the cover takes the biggest area of it that its own proportions allow
const CARD_PADDING = px(48);
const COVER_MAX = { width: px(520), height: size.height - 2 * CARD_PADDING };

export default async function Image({ params }: { params: Promise<{ code: string; tableId: string }> }) {
  const { code, tableId } = await params;
  const t = await getSharedTable(code, tableId).catch(() => null);
  const cover = t?.open ? await loadCover(t.imageUrl, COVER_MAX) : null;

  const shell = { display: 'flex', width: '100%', height: '100%', background: '#0b0f19', color: '#f3f4f6', padding: CARD_PADDING } as const;

  // No such table, or it is no longer open: the plain brand card
  if (!t || !t.open) {
    return new ImageResponse(
      (
        <div style={{ ...shell, flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ display: 'flex', fontSize: px(84), color: '#818cf8' }}>Meeple Loop</div>
          <div style={{ display: 'flex', fontSize: px(36), color: '#9ca3af', marginTop: px(16) }}>Mesas de juegos de mesa para tu evento</div>
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
          <img src={cover.uri} alt="" width={cover.width} height={cover.height} style={{ width: cover.width, height: cover.height, borderRadius: px(20) }} />
        ) : (
          <div style={{ display: 'flex', width: px(380), height: COVER_MAX.height, borderRadius: px(24), background: '#1f2937', alignItems: 'center', justifyContent: 'center', fontSize: px(40), color: '#6b7280' }}>
            Sin portada
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flex: 1, marginLeft: px(52) }}>
          <div style={{ display: 'flex', fontSize: px(28), color: '#818cf8', letterSpacing: px(4) }}>MEEPLE LOOP</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', fontSize: px(40), color: '#fbbf24' }}>{sharePrompt()}</div>
            <div style={{ display: 'flex', fontSize: px(nameSize), lineHeight: 1.1, marginTop: px(12) }}>{t.gameName}</div>
            <IconRow icon="calendar" fontSize={px(36)} color="#e5e7eb" marginTop={px(28)}>{dayText}</IconRow>
            <IconRow icon="clock" fontSize={px(36)} color="#e5e7eb" marginTop={px(10)}>{t.startTime} – {t.endTime}</IconRow>
            {t.location && <IconRow icon="pin" fontSize={px(32)} color="#9ca3af" marginTop={px(10)}>{t.location}</IconRow>}
          </div>
          <div style={{ display: 'flex', fontSize: px(28), color: '#9ca3af' }}>{t.eventName}</div>
        </div>
      </div>
    ),
    { ...size }
  );
}
