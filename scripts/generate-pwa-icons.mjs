// Generates the installable-app icons in public/ from src/assets/meeple-loop-logo.png.
// Run once (and again only if the logo changes):  node scripts/generate-pwa-icons.mjs
//
//   icon-192.png / icon-512.png   the logo as-is on a transparent background ("any" purpose)
//   icon-maskable-512.png         the logo at ~70% on a solid background, so Android can crop it to
//                                 a circle / squircle / rounded square without cutting the artwork
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const logo = fileURLToPath(new URL('../src/assets/meeple-loop-logo.png', import.meta.url));
const out = (name) => fileURLToPath(new URL(`../public/${name}`, import.meta.url));

for (const size of [192, 512]) {
  await sharp(logo).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ compressionLevel: 9, palette: true }).toFile(out(`icon-${size}.png`));
}

// Maskable: the safe zone is the inner 80% circle; keep the artwork well inside it.
const size = 512;
const inner = Math.round(size * 0.7);
const artwork = await sharp(logo).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
await sharp({ create: { width: size, height: size, channels: 4, background: '#030712' } })
  .composite([{ input: artwork, gravity: 'center' }])
  .png({ compressionLevel: 9, palette: true })
  .toFile(out('icon-maskable-512.png'));

console.log('Wrote public/icon-192.png, icon-512.png, icon-maskable-512.png');
