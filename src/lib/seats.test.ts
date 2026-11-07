import { describe, expect, it } from 'vitest';
import { MIN_TABLE_SEATS, minSeats } from './seats';

describe('minSeats', () => {
  it('never lets a table be a one-person table, even for solo-capable games', () => {
    expect(MIN_TABLE_SEATS).toBe(2);
    expect(minSeats({ minPlayers: 1 })).toBe(2);
    expect(minSeats({ minPlayers: 0 })).toBe(2);
  });
  it('keeps the game\'s own minimum when it is higher', () => {
    expect(minSeats({ minPlayers: 2 })).toBe(2);
    expect(minSeats({ minPlayers: 4 })).toBe(4);
  });
});
