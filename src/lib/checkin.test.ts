import { describe, expect, it } from 'vitest';
import { buildCheckinPayload, parseCheckinPayload } from './checkin';

describe('check-in QR payload', () => {
  it('round-trips the event and ticket codes', () => {
    const text = buildCheckinPayload('NRFYDR', 'ACDEFG');
    expect(text).toBe('MEEPLELOOP|NRFYDR|ACDEFG');
    expect(parseCheckinPayload(text)).toEqual({ eventCode: 'NRFYDR', ticketCode: 'ACDEFG' });
  });

  it('tolerates whitespace around the scanned text', () => {
    expect(parseCheckinPayload('  MEEPLELOOP|NRFYDR|ACDEFG\n')?.ticketCode).toBe('ACDEFG');
  });

  it('rejects anything that is not one of our QR codes', () => {
    expect(parseCheckinPayload('https://example.com')).toBeNull();
    expect(parseCheckinPayload('MEEPLELOOP|../x|ABC')).toBeNull();
    expect(parseCheckinPayload('MEEPLELOOP|NRFYDR')).toBeNull();
    expect(parseCheckinPayload('MEEPLELOOP|NRFYDR|ACDEFG|extra')).toBeNull();
    expect(parseCheckinPayload('OTHER|NRFYDR|ACDEFG')).toBeNull();
    expect(parseCheckinPayload('')).toBeNull();
  });
});
