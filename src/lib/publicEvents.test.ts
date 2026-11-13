import { describe, expect, it } from 'vitest';
import { isLocalhostName, listedByDefault, oldestDateToList, toPublicEvent } from './publicEvents';
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

describe('a new event and the public list', () => {
  it('is listed by default, except when it is created from localhost (a test)', () => {
    expect(listedByDefault(false)).toBe(true);
    expect(listedByDefault(true)).toBe(false);
  });
  it('knows the developer machine from the real site', () => {
    expect(isLocalhostName('localhost')).toBe(true);
    expect(isLocalhostName('127.0.0.1')).toBe(true);
    expect(isLocalhostName('meeple-match.vercel.app')).toBe(false);
    expect(isLocalhostName('172.19.128.1')).toBe(false);
  });
});

describe('toPublicEvent', () => {
  it('keeps only what the list shows: no payment data, nothing about people', () => {
    const p = toPublicEvent('ABC123', event(), 7, now);
    expect(p).toEqual({
      code: 'ABC123', name: 'Jornada', date: '2026-11-15', startTime: '10:00', endTime: '18:00', location: 'Club',
      mapUrl: null, bannerUrl: 'https://img/x.jpg', players: 7, geo: null,
    });
    expect(JSON.stringify(p)).not.toContain('alias');
    expect(JSON.stringify(p)).not.toContain('bancarios');
  });
  it('carries the pin when it is known, and only its coordinates', () => {
    const p = toPublicEvent('ABC123', event(), 7, now, { lat: -31.4, lng: -64.2 });
    expect(p?.geo).toEqual({ lat: -31.4, lng: -64.2 });
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
