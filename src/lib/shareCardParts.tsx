import type { ReactNode } from 'react';
import { fitInside, imageSize } from '@/lib/imageSize';

// Pieces shared by the two pictures made for a table: the link-preview card and the Instagram story.

// The cover URL comes from the game's own data, which players fill in: only fetch it from where BGG covers live
const COVER_HOSTS = /(^|\.)geekdo-images\.com$/;

/**
 * The cover as an inline image (the picture renderer reads jpeg/png), sized to fit inside `max` with its own proportions,
 * or null when it can't be had quickly and safely.
 */
export async function loadCover(
  url: string | null, max: { width: number; height: number }
): Promise<{ uri: string; width: number; height: number } | null> {
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
    return { uri: `data:${type};base64,${Buffer.from(bytes).toString('base64')}`, ...fitInside(dims, max.width, max.height) };
  } catch {
    return null;
  }
}

// Icons are drawn here (the picture renderer can't draw emoji): simple outlines in the app's violet.
// Grouped with <g>: the renderer does not take React fragments.
const ICON_PATHS: Record<'calendar' | 'clock' | 'pin' | 'arrow-down', ReactNode> = {
  'arrow-down': (
    <g>
      <path d="M12 4v15M5 13l7 7 7-7" />
    </g>
  ),
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

/** One line of the card: an icon and its text. Every number is already in pixels of the picture being drawn. */
export function IconRow({ icon, fontSize, color, marginTop, justify = 'flex-start', children }: {
  icon: keyof typeof ICON_PATHS; fontSize: number; color: string; marginTop: number; justify?: 'flex-start' | 'center'; children: ReactNode;
}) {
  const iconSize = Math.round(fontSize * 1.05);
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: justify, fontSize, color, marginTop }}>
      <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
        style={{ marginRight: Math.round(fontSize * 0.45), flexShrink: 0 }}>
        {ICON_PATHS[icon]}
      </svg>
      <div style={{ display: 'flex' }}>{children}</div>
    </div>
  );
}
