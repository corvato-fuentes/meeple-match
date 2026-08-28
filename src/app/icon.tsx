import { ImageResponse } from 'next/og';
import { readFileSync } from 'fs';
import { join } from 'path';

export const size = { width: 64, height: 64 };
export const contentType = 'image/png';

export default function Icon() {
  const buf = readFileSync(join(process.cwd(), 'src/assets/meeple-fire.jpg'));
  const src = `data:image/jpeg;base64,${buf.toString('base64')}`;
  return new ImageResponse(
    (
      <img
        src={src}
        width={size.width}
        height={size.height}
        style={{ objectFit: 'cover', objectPosition: 'center' }}
      />
    ),
    { ...size }
  );
}
