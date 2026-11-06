import { describe, expect, it } from 'vitest';
import { displayNameOf } from './playerName';

describe('displayNameOf', () => {
  it('uses first and last name when there is no alias', () => {
    expect(displayNameOf('Ana', 'Pérez')).toBe('Ana Pérez');
    expect(displayNameOf(' Ana ', ' Pérez ', null)).toBe('Ana Pérez');
    expect(displayNameOf('Ana', 'Pérez', '   ')).toBe('Ana Pérez');
  });
  it('prefers the alias', () => {
    expect(displayNameOf('Ana', 'Pérez', ' Anita ')).toBe('Anita');
  });
  it('does not leave stray spaces when the last name is empty', () => {
    expect(displayNameOf('Ana', '')).toBe('Ana');
  });
});
