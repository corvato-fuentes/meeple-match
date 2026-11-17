import { describe, expect, it } from 'vitest';
import { findGameByText, newGameMinutes, proposedMinutes, suggestGames } from './improvised';

const g = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, ...extra }) as never;

describe('findGameByText', () => {
  const games = [g('1', 'Catan'), g('2', 'Catan', { adHoc: true }), g('3', 'Dixit', { adHoc: true })];
  it('finds a game by its name whatever the case or accents, the library one first', () => {
    expect(findGameByText('  catán ', games)?.id).toBe('1');
    expect(findGameByText('DIXIT', games)?.id).toBe('3');
  });
  it('finds nothing for a game that is not there, or for empty text', () => {
    expect(findGameByText('Carcassonne', games)).toBeNull();
    expect(findGameByText('   ', games)).toBeNull();
  });
});

describe('suggestGames', () => {
  const games = [g('1', 'Azul'), g('2', 'Azul: Vitral de Sintra', { adHoc: true }), g('3', 'Brass: Birmingham'), g('4', 'Azul', { groupId: '1' }), g('5', 'Azul viejo', { deleted: true })];
  it('suggests the games that contain the text, the library first, each copy once, without the deleted ones', () => {
    expect(suggestGames('azul', games).map((x) => x.id)).toEqual(['1', '2']);
  });
  it('suggests nothing for empty text', () => {
    expect(suggestGames('', games)).toEqual([]);
  });
});

describe('proposedMinutes', () => {
  it('uses the game\'s own numbers with the people at the table, rounded up to 5', () => {
    const game = g('1', 'Brass', { setupMinutes: 10, explanationMinutes: 12, perPlayerMinutes: 15, durationMinutes: 999 });
    expect(proposedMinutes(game, 3)).toBe(70); // 10 + 12 + 45 = 67 -> 70
    expect(proposedMinutes(game, 4)).toBe(85); // 82 -> 85
  });
  it('uses the flat duration when the game has no times', () => {
    expect(proposedMinutes(g('1', 'Dixit', { durationMinutes: 100 }), 4)).toBe(100);
  });
  it('is 90 while there is no game yet, and counts at least 2 people', () => {
    expect(proposedMinutes(null, 3)).toBe(90);
    expect(proposedMinutes(g('1', 'X', { perPlayerMinutes: 10, setupMinutes: 0, explanationMinutes: 0, durationMinutes: 0 }), 1)).toBe(20);
  });
});

describe('newGameMinutes', () => {
  it('adds setup, explanation and the minutes of each person, rounded up to 5', () => {
    expect(newGameMinutes({ setupMinutes: 5, explanationMinutes: 10, perPlayerMinutes: 15 }, 4)).toBe(75);
    expect(newGameMinutes({ setupMinutes: 3, explanationMinutes: 4, perPlayerMinutes: 7 }, 3)).toBe(30); // 28 -> 30
  });
});
