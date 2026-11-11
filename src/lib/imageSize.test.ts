import { describe, expect, it } from 'vitest';
import { fitInside, imageSize } from './imageSize';

const png = (w: number, h: number) => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  b.set([w >>> 24, (w >>> 16) & 255, (w >>> 8) & 255, w & 255], 16);
  b.set([h >>> 24, (h >>> 16) & 255, (h >>> 8) & 255, h & 255], 20);
  return b;
};

// SOI, an APP0 segment (to be skipped), then a baseline start-of-frame segment with the size
const jpeg = (w: number, h: number) => new Uint8Array([
  0xff, 0xd8,
  0xff, 0xe0, 0x00, 0x06, 0x4a, 0x46, 0x49, 0x46,
  0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
]);

describe('imageSize', () => {
  it('reads a PNG size from its header', () => {
    expect(imageSize(png(1200, 1500))).toEqual({ width: 1200, height: 1500 });
  });
  it('reads a JPEG size from its start-of-frame segment, skipping the ones before it', () => {
    expect(imageSize(jpeg(3000, 4096))).toEqual({ width: 3000, height: 4096 });
    expect(imageSize(jpeg(800, 600))).toEqual({ width: 800, height: 600 });
  });
  it('is null for anything else', () => {
    expect(imageSize(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]))).toBeNull();
    expect(imageSize(new Uint8Array([]))).toBeNull();
    expect(imageSize(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
  });
});

describe('fitInside', () => {
  it('keeps the proportions and fills the available space', () => {
    expect(fitInside({ width: 1000, height: 1250 }, 500, 500)).toEqual({ width: 400, height: 500 }); // tall: height is the limit
    expect(fitInside({ width: 1250, height: 1000 }, 500, 500)).toEqual({ width: 500, height: 400 }); // wide: width is the limit
  });
  it('also makes a small picture larger, to fill the space', () => {
    expect(fitInside({ width: 100, height: 200 }, 500, 400)).toEqual({ width: 200, height: 400 });
  });
});
