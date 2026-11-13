import { describe, expect, it } from 'vitest';
import { oldestDateToList, toPublicEvent } from './publicEvents';
import type { MeepleEvent } from './types';

const event = (over: Partial<MeepleEvent> = {}, settings: Partial<MeepleEvent['settings']> = {}): MeepleEvent => ({
  name: 'Jornada', date: '2026-11-15', startTime: '10:00', endTime: '18:00', location: 'Club', mapUrl: null,
  settings: {
    bufferMinutes: 15, maxPlayers: null, maxGamesPerPlayer: null, physicalTables: null, breaks: [],
    paymentRequired: true, paymentInfo: 'datos bancarios', paymentAlias: 'mi.alias', registrationBannerUrl: 'https://img/x.jpg', ...settings,
  },
  ...over,
});
const now = new Date('2026-11-13T12:00:00Z');

describe('toPublicEvent', () => {
  it('keeps only what the list shows: no payment data, nothing about people', () => {
    const p = toPublicEvent('ABC123', event(), 7, now);
    expect(p).toEqual({
      code: 'ABC123', name: 'Jornada', date: '2026-11-15', startTime: '10:00', endTime: '18:00', location: 'Club',
      mapUrl: null, bannerUrl: 'https://img/x.jpg', players: 7,
    });
    expect(JSON.stringify(p)).not.toContain('alias');
    expect(JSON.stringify(p)).not.toContain('bancarios');
  });
  it('lists every event unless the organizer turned it off', () => {
    expect(toPublicEvent('A', event({}, { listed: undefined }), 0, now)).not.toBeNull();
    expect(toPublicEvent('A', event({}, { listed: true }), 0, now)).not.toBeNull();
    expect(toPublicEvent('A', event({}, { listed: false }), 0, now)).toBeNull();
  });
  it('leaves out events clearly in the past, and ones without a name or day', () => {
    expect(toPublicEvent('A', event({ date: '2026-11-01' }), 0, now)).toBeNull();
    expect(toPublicEvent('A', event({ name: '' }), 0, now)).toBeNull();
    expect(toPublicEvent('A', event({ date: '' }), 0, now)).toBeNull();
  });
  it('keeps yesterday and today (the exact end is decided on the device)', () => {
    expect(oldestDateToList(now)).toBe('2026-11-12');
    expect(toPublicEvent('A', event({ date: '2026-11-12' }), 0, now)).not.toBeNull();
    expect(toPublicEvent('A', event({ date: '2026-11-13' }), 0, now)).not.toBeNull();
  });
});
