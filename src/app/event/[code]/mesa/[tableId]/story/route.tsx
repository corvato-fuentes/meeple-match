import { ImageResponse } from 'next/og';
import { getSharedTable } from '@/lib/shareTableServer';
import { dayLabel, sharePrompt } from '@/lib/shareTable';
import { IconRow, loadCover } from '@/lib/shareCardParts';

// The picture people post as an Instagram story: vertical (9:16), with the table's data. Instagram covers the top and the
// bottom of a story with its own controls, so everything sits in the middle band; the link goes in a link sticker (the
// app copies it), which the person drops right under the "Tocá el link para sumarte" cue.
export const dynamic = 'force-dynamic';

const WIDTH = 1080;
const HEIGHT = 1920;

export async function GET(_req: Request, { params }: { params: Promise<{ code: string; tableId: string }> }) {
  const { code, tableId } = await params;
  const t = await getSharedTable(code, tableId).catch(() => null);
  if (!t || !t.open) return new Response('Esta mesa ya no está disponible', { status: 404 });
  const cover = await loadCover(t.imageUrl, { width: 880, height: 620 });

  const day = dayLabel(t.date);
  const dayText = day.charAt(0).toUpperCase() + day.slice(1);
  const nameSize = t.gameName.length > 34 ? 70 : t.gameName.length > 22 ? 86 : 104;
  return new ImageResponse(
    (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', height: '100%', background: '#0b0f19', color: '#f3f4f6', padding: '170px 80px 0 80px' }}>
        <div style={{ display: 'flex', fontSize: 38, color: '#818cf8', letterSpacing: 8 }}>MEEPLE LOOP</div>
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover.uri} alt="" width={cover.width} height={cover.height} style={{ width: cover.width, height: cover.height, borderRadius: 36, marginTop: 32 }} />
        ) : (
          <div style={{ display: 'flex', width: 640, height: 640, borderRadius: 36, marginTop: 32, background: '#1f2937', alignItems: 'center', justifyContent: 'center', fontSize: 60, color: '#6b7280' }}>
            Sin portada
          </div>
        )}
        <div style={{ display: 'flex', fontSize: 56, color: '#fbbf24', marginTop: 48 }}>{sharePrompt()}</div>
        <div style={{ display: 'flex', fontSize: nameSize, lineHeight: 1.1, marginTop: 14, textAlign: 'center', justifyContent: 'center' }}>{t.gameName}</div>
        <IconRow icon="calendar" fontSize={48} color="#e5e7eb" marginTop={40} justify="center">{dayText}</IconRow>
        <IconRow icon="clock" fontSize={48} color="#e5e7eb" marginTop={16} justify="center">{t.startTime} – {t.endTime}</IconRow>
        {t.location && <IconRow icon="pin" fontSize={42} color="#9ca3af" marginTop={16} justify="center">{t.location}</IconRow>}
        <div style={{ display: 'flex', fontSize: 38, color: '#9ca3af', marginTop: 28, textAlign: 'center', justifyContent: 'center' }}>{t.eventName}</div>
        {/* Marks where the link sticker goes, and tells whoever watches the story to tap it */}
        <div style={{ display: 'flex', marginTop: 40, padding: '20px 44px', borderRadius: 999, background: '#312e81' }}>
          <IconRow icon="arrow-down" fontSize={46} color="#e0e7ff" marginTop={0} justify="center">Tocá el link para sumarte</IconRow>
        </div>
      </div>
    ),
    { width: WIDTH, height: HEIGHT }
  );
}
