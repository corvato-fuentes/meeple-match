/**
 * Width and height of a PNG or JPEG, read from its first bytes (no decoding). The shared-table card uses it to give the
 * cover the exact shape of the picture, so it can be as large as the card allows without cropping or leaving bars.
 * Null when the bytes aren't a PNG/JPEG this can read.
 */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const u16 = (i: number) => (bytes[i] << 8) | bytes[i + 1];
  const u32 = (i: number) => ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;

  // PNG: 8-byte signature, then the IHDR chunk (length, "IHDR", width, height)
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const width = u32(16);
    const height = u32(20);
    return width > 0 && height > 0 ? { width, height } : null;
  }

  // JPEG: walk the segments until a "start of frame" one, which carries the size
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const marker = bytes[i + 1];
      if (marker === 0xff) { i++; continue; } // padding
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; } // no length
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) {
        const height = u16(i + 5);
        const width = u16(i + 7);
        return width > 0 && height > 0 ? { width, height } : null;
      }
      i += 2 + u16(i + 2);
    }
  }
  return null;
}

/** The largest size with this picture's proportions that fits inside maxWidth × maxHeight (never stretched, never cropped). */
export function fitInside(size: { width: number; height: number }, maxWidth: number, maxHeight: number): { width: number; height: number } {
  const scale = Math.min(maxWidth / size.width, maxHeight / size.height);
  return { width: Math.round(size.width * scale), height: Math.round(size.height * scale) };
}
