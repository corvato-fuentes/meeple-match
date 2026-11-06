import { describe, expect, it } from 'vitest';
import { toWhatsappNumber, whatsappLink } from './whatsapp';

describe('toWhatsappNumber', () => {
  it.each([
    ['+54 9 351 555-1234', '5493515551234'],
    ['351 5551234', '5493515551234'],
    ['3515551234', '5493515551234'],
    ['0351 15 5551234', '5493515551234'],
    ['0351 155551234', '5493515551234'],
    ['(011) 15-5555-1234', '5491155551234'],
    ['11 5555-1234', '5491155551234'],
    ['+54 11 5555 1234', '5491155551234'],
    ['+54 9 11 5555 1234', '5491155551234'],
    ['+54 351 5551234', '5493515551234'],
    ['5493515551234', '5493515551234'],
    ['543515551234', '5493515551234'],
    ['0054 9 351 5551234', '5493515551234'],
    ['0054 11 5555-1234', '5491155551234'],
    ['2966 15 123456', '5492966123456'],
  ])('turns %s into the WhatsApp form %s', (typed, expected) => {
    expect(toWhatsappNumber(typed)).toBe(expected);
  });

  it('keeps foreign numbers that were typed with their country code', () => {
    expect(toWhatsappNumber('+34 612 345 678')).toBe('34612345678');
    expect(toWhatsappNumber('+1 (415) 555-2671')).toBe('14155552671');
    expect(toWhatsappNumber('+598 91 234 567')).toBe('59891234567');
  });

  it('refuses foreign numbers typed WITHOUT a country code instead of guessing Argentina (wrong chat)', () => {
    expect(toWhatsappNumber('34612345678')).toBeNull();
    expect(toWhatsappNumber('612 345 678')).toBeNull();
    expect(toWhatsappNumber('4155552671')).toBeNull(); // area code starting with 4 isn't Argentine
    expect(toWhatsappNumber('598 91 234 567')).toBeNull();
  });

  it('returns null for anything that is not a phone number', () => {
    expect(toWhatsappNumber('abc')).toBeNull();
    expect(toWhatsappNumber('')).toBeNull();
    expect(toWhatsappNumber('123')).toBeNull();
  });
});

describe('whatsappLink', () => {
  it('builds a wa.me link with the message encoded', () => {
    expect(whatsappLink('351 555-1234', 'Hola! Soy Ana & vengo del evento'))
      .toBe('https://wa.me/5493515551234?text=Hola!%20Soy%20Ana%20%26%20vengo%20del%20evento');
  });
  it('works without a message', () => {
    expect(whatsappLink('351 555-1234')).toBe('https://wa.me/5493515551234');
  });
  it('gives no link when there is no usable number', () => {
    expect(whatsappLink(null)).toBeNull();
    expect(whatsappLink(undefined)).toBeNull();
    expect(whatsappLink('xx')).toBeNull();
  });
});
