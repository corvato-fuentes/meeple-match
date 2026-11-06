import { ImageResponse } from 'next/og';
import { readFileSync } from 'fs';
import { join } from 'path';

export const size = { width: 64, height: 64 };
export const contentType = 'image/png';

export default function Icon() {
  const buf = readFileSync(join(process.cwd(), 'src/assets/meeple-loop-logo.png'));
  const src = `data:image/png;base64,${buf.toString('base64')}`;
  return new ImageResponse(
    (
      // ImageResponse renders to a PNG, so next/image does not apply here
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt=""
        src={src}
        width={size.width}
        height={size.height}
        style={{ objectFit: 'contain', objectPosition: 'center' }}
      />
    ),
    { ...size }
  );
}
