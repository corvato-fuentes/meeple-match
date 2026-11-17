import type { Player } from './types';

/**
 * People who sit at a table without using the app ("sin registrar"): the organizers write them down by name when they put them in
 * an improvised table, and can then seat them in other tables. They are players only so that they take a seat and can be moved: they
 * vote nothing, are offered nothing, get no ticket, and never count as someone registered (the algorithm, the roster, the totals and
 * the door's list all leave them out).
 */
export const isUnregistered = (p: Pick<Player, 'unregistered'>): boolean => p.unregistered === true;

/** The registered ones: what everything that counts people (the algorithm, the totals, the roster) works with. */
export const registeredOnly = <T extends Pick<Player, 'unregistered'>>(players: T[]): T[] => players.filter((p) => !isUnregistered(p));

const BLANK_NAME = 'Invitado';

/**
 * The names for the people just written down: what was typed (trimmed, one line), or "Invitado N" — numbered after the ones already
 * there — when it was left empty.
 */
export function guestNames(typed: string[], existingGuests: number): string[] {
  let n = existingGuests;
  return typed.map((t) => {
    const name = t.replace(/\s+/g, ' ').trim().slice(0, 40);
    if (name) return name;
    n += 1;
    return `${BLANK_NAME} ${n}`;
  });
}

/** How the organizers see them in their lists: the name and that they don't use the app. */
export const withGuestMark = (p: Player): Player => (isUnregistered(p) ? { ...p, name: `${p.name} (sin app)` } : p);
