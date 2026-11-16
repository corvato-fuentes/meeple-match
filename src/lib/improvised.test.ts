import { describe, expect, it } from 'vitest';
import { defaultDuration, findGameByText, suggestGames } from './improvised';

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

describe('defaultDuration', () => {
  it('is the closest offered duration, or 90 when the game does not say', () => {
    expect(defaultDuration(null)).toBe(90);
    expect(defaultDuration({ durationMinutes: 0 })).toBe(90);
    expect(defaultDuration({ durationMinutes: 50 })).toBe(45);
    expect(defaultDuration({ durationMinutes: 100 })).toBe(90);
    expect(defaultDuration({ durationMinutes: 400 })).toBe(180);
  });
});
