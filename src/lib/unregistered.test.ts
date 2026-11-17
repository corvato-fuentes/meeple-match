import { describe, expect, it } from 'vitest';
import { guestNames, isUnregistered, registeredOnly, withGuestMark } from './unregistered';

const p = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, ...extra }) as never;

describe('unregistered people', () => {
  it('tells them apart, and the registered ones are what is left when they are taken out', () => {
    expect(isUnregistered(p('a'))).toBe(false);
    expect(isUnregistered(p('b', { unregistered: true }))).toBe(true);
    expect(registeredOnly([p('a'), p('b', { unregistered: true }), p('c')]).map((x: { id: string }) => x.id)).toEqual(['a', 'c']);
  });

  it('names them: what was typed, or "Invitado N" numbered after the ones already there', () => {
    expect(guestNames(['  Ana   Paz ', '', 'x'.repeat(60), ''], 2)).toEqual(['Ana Paz', 'Invitado 3', 'x'.repeat(40), 'Invitado 4']);
    expect(guestNames([], 5)).toEqual([]);
  });

  it('marks them in the lists of the organizers, and leaves everyone else as is', () => {
    expect(withGuestMark(p('b', { unregistered: true })).name).toBe('b (sin app)');
    expect(withGuestMark(p('a')).name).toBe('a');
  });
});
