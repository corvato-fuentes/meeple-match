'use client';

/** Small portrait box-art thumbnail for table cards; falls back to the generic "SIN PORTADA" art. */
export default function GameCover({ imageUrl, size = 'sm' }: { imageUrl?: string | null; size?: 'sm' | 'md' }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={imageUrl || '/cover-placeholder.png'} alt=""
      className={(size === 'md' ? 'w-12 h-[3.75rem]' : 'w-9 h-11') + ' rounded object-cover border border-gray-700 bg-gray-900 shrink-0'} />
  );
}
