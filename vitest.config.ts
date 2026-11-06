import { defineConfig } from 'vitest/config';
import path from 'path';

// Unit tests for the pure logic (scheduling algorithm, notification rules, phone / QR / filter helpers…).
// They live next to the code as *.test.ts and don't need Firebase, a browser or a running server.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
});
