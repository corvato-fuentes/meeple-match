import { describe, expect, it } from 'vitest';
import { formatPhoneDisplay } from './phone';

describe('formatPhoneDisplay', () => {
  it('shows every way of writing the same Córdoba mobile identically', () => {
    for (const typed of [
      '0351 15 555-1234', '351 5551234', '3515551234', '+54 9 351 555-1234', '+54 351 5551234',
      '5493515551234', '0351 155551234', '(0351) 15-555-1234', '0054 9 351 555 1234',
    ]) {
      expect(formatPhoneDisplay(typed)).toEqual({ text: '351 555-1234', tel: '+5493515551234' });
    }
  });

  it('groups by the length of the area code', () => {
    expect(formatPhoneDisplay('(011) 15-5555-1234').text).toBe('11 5555-1234');      // Buenos Aires: 2 digits
    expect(formatPhoneDisplay('2615551234').text).toBe('261 555-1234');                // Mendoza: 3 digits
    expect(formatPhoneDisplay('0341 15 5551234').text).toBe('341 555-1234');           // Rosario: 3 digits
    expect(formatPhoneDisplay('2966 15 123456').text).toBe('2966 12-3456');            // 4 digits
    expect(formatPhoneDisplay('03541 15 123456').text).toBe('3541 12-3456');           // Villa Carlos Paz
  });

  it('offers a tel: number in international form for Argentine mobiles', () => {
    expect(formatPhoneDisplay('11 5555-1234').tel).toBe('+5491155551234');
  });

  it('shows foreign numbers typed with a country code as +digits', () => {
    expect(formatPhoneDisplay('+34 612 345 678')).toEqual({ text: '+34612345678', tel: '+34612345678' });
  });

  it('leaves what it cannot read as typed, without a call link', () => {
    expect(formatPhoneDisplay('34612345678')).toEqual({ text: '34612345678', tel: null });
    expect(formatPhoneDisplay('abc')).toEqual({ text: 'abc', tel: null });
    expect(formatPhoneDisplay('  ')).toEqual({ text: '', tel: null });
  });
});
