import { describe, expect, it } from 'vitest';
import { mergeSavedEvents, sortCards, whenOf } from './homeEvents';

const at = (iso: string) => new Date(iso);

describe('mergeSavedEvents', () => {
  it('one card per event: an event the person organizes and also has a ticket for is a single card with both', () => {
    const cards = mergeSavedEvents(
      [{ code: 'AAA111', adminToken: 'tok', name: 'Jornada', date: '2026-11-15', savedAt: 1 }],
      [
        { code: 'AAA111', ticketCode: 'TT1', name: 'Jornada', date: '2026-11-15', playerName: 'Ana', savedAt: 2 },
        { code: 'BBB222', ticketCode: 'TT2', name: 'Noche', date: '2026-12-01', playerName: 'Ana', savedAt: 3 },
      ],
    );
    expect(cards).toHaveLength(2);
    expect(cards.find((c) => c.code === 'AAA111')).toMatchObject({ admin: { adminToken: 'tok' }, ticket: { ticketCode: 'TT1' } });
    expect(cards.find((c) => c.code === 'BBB222')?.admin).toBeUndefined();
  });
});

describe('whenOf', () => {
  const ev = { date: '2026-11-15', startTime: '10:00', endTime: '20:00' };
  it('says how far away the event is', () => {
    expect(whenOf(ev, at('2026-11-15T08:00:00')).label).toBe('Hoy');
    expect(whenOf(ev, at('2026-11-14T23:00:00')).label).toBe('Mañana');
    expect(whenOf(ev, at('2026-11-12T12:00:00')).label).toBe('En 3 días');
    expect(whenOf(ev, at('2026-10-01T12:00:00'))).toEqual({ label: 'En 45 días', tone: 'later' });
  });
  it('knows when it is happening and when it is over', () => {
    expect(whenOf(ev, at('2026-11-15T15:00:00'))).toEqual({ label: 'En curso', tone: 'live' });
    expect(whenOf(ev, at('2026-11-15T20:00:00'))).toEqual({ label: 'Finalizó', tone: 'past' });
    expect(whenOf(ev, at('2026-11-16T09:00:00')).tone).toBe('past');
  });
  it('without the hours it counts the whole day', () => {
    expect(whenOf({ date: '2026-11-15' }, at('2026-11-15T22:00:00')).tone).toBe('live');
    expect(whenOf({ date: '2026-11-15' }, at('2026-11-16T00:30:00')).tone).toBe('past');
  });
});

describe('sortCards', () => {
  it('what is on or coming first goes first, the events already over go last, newest first', () => {
    const cards = [
      { code: 'old', date: '2026-10-01' }, { code: 'later', date: '2026-12-20' }, { code: 'soon', date: '2026-11-15' },
      { code: 'older', date: '2026-09-01' },
    ];
    expect(sortCards(cards, at('2026-11-13T12:00:00')).map((c) => c.code)).toEqual(['soon', 'later', 'old', 'older']);
  });
});
