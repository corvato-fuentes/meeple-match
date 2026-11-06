'use client';

const SIZE_CLASS = { sm: 'w-9 h-11', md: 'w-12 h-[3.75rem]', ml: 'w-16 h-20', lg: 'w-24 h-32' } as const;

/** Portrait box-art thumbnail for cards (sm/md in table lists, lg where the cover is a main part of the card);
 *  falls back to the generic "SIN PORTADA" art. */
export default function GameCover({ imageUrl, size = 'sm' }: { imageUrl?: string | null; size?: keyof typeof SIZE_CLASS }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={imageUrl || '/cover-placeholder.png'} alt=""
      className={SIZE_CLASS[size] + (size === 'lg' ? ' rounded-lg' : ' rounded') + ' object-cover border border-gray-700 bg-gray-900 shrink-0'} />
  );
}
