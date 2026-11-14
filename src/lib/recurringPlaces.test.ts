import { describe, expect, it } from 'vitest';
import { RECURRING_PLACES, instagramLink, placeAddressText, placeMapUrl, whatsappLink } from './recurringPlaces';

describe('whatsappLink', () => {
  it('turns a number into a chat link, ignoring spaces and signs', () => {
    expect(whatsappLink('+54 9 351 123-4567')).toBe('https://wa.me/5493511234567');
  });
  it('keeps the link of a chat or group, but only WhatsApp\'s own', () => {
    expect(whatsappLink('https://chat.whatsapp.com/AbCdEf123')).toBe('https://chat.whatsapp.com/AbCdEf123');
    expect(whatsappLink('https://wa.me/5493511234567')).toBe('https://wa.me/5493511234567');
    expect(whatsappLink('https://evil.example/wa.me/123')).toBeNull();
    expect(whatsappLink('http://wa.me/5493511234567')).toBeNull();
    expect(whatsappLink('javascript:alert(1)')).toBeNull();
  });
  it('is null when empty or not a number', () => {
    expect(whatsappLink('')).toBeNull();
    expect(whatsappLink(undefined)).toBeNull();
    expect(whatsappLink('llamar a Juan')).toBeNull();
    expect(whatsappLink('123')).toBeNull();
  });
});

describe('instagramLink', () => {
  it('turns a user name, with or without @, into the profile link', () => {
    expect(instagramLink('@casa.hipa')).toBe('https://www.instagram.com/casa.hipa/');
    expect(instagramLink('pesima_jugada')).toBe('https://www.instagram.com/pesima_jugada/');
  });
  it('keeps a profile link, but only Instagram\'s own', () => {
    expect(instagramLink('https://www.instagram.com/casa.hipa/')).toBe('https://www.instagram.com/casa.hipa/');
    expect(instagramLink('https://instagram.com.evil.example/x')).toBeNull();
    expect(instagramLink('https://example.com/instagram.com')).toBeNull();
  });
  it('is null when empty or not a valid user name', () => {
    expect(instagramLink('')).toBeNull();
    expect(instagramLink(undefined)).toBeNull();
    expect(instagramLink('con espacios')).toBeNull();
    expect(instagramLink('a/b')).toBeNull();
  });
});

describe('the places listed', () => {
  it('have a unique id, a pin inside Córdoba province and at least one schedule', () => {
    expect(new Set(RECURRING_PLACES.map((p) => p.id)).size).toBe(RECURRING_PLACES.length);
    for (const p of RECURRING_PLACES) {
      expect(p.schedules.length).toBeGreaterThan(0);
      expect(p.geo.lat).toBeGreaterThan(-32.5);
      expect(p.geo.lat).toBeLessThan(-30.5);
      expect(p.geo.lng).toBeGreaterThan(-65);
      expect(p.geo.lng).toBeLessThan(-63.5);
    }
  });
  it('whatever contact is filled in is valid (so its icon really shows)', () => {
    for (const p of RECURRING_PLACES) {
      if (p.whatsapp) expect(whatsappLink(p.whatsapp), `${p.id} whatsapp`).not.toBeNull();
      if (p.instagram) expect(instagramLink(p.instagram), `${p.id} instagram`).not.toBeNull();
    }
  });
  it('says "Consultar lugar" when there is no address, and has no map link then', () => {
    const vcp = RECURRING_PLACES.find((p) => p.id === 'club-de-juegos-vcp')!;
    expect(placeAddressText(vcp)).toBe('Consultar lugar');
    expect(placeMapUrl(vcp)).toBeNull();
    const hipa = RECURRING_PLACES.find((p) => p.id === 'casa-hipa')!;
    expect(placeAddressText(hipa)).toBe('Paso de los Andes 222, Córdoba');
    expect(placeMapUrl(hipa)).toContain('google.com/maps');
  });
});
