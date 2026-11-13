import { describe, expect, it } from 'vitest';
import { coordsFromText, geoKeyOf, isAllowedMapUrl, knownGeo } from './geo';

describe('coordsFromText', () => {
  it('reads the usual Google Maps shapes', () => {
    expect(coordsFromText('https://www.google.com/maps/place/Algo/@-31.4135,-64.1811,17z/data=x')).toEqual({ lat: -31.4135, lng: -64.1811 });
    expect(coordsFromText('https://www.google.com/maps/place/Algo/data=!4m2!3m1!1s0x0:0x1!3d-31.41!4d-64.17')).toEqual({ lat: -31.41, lng: -64.17 });
    expect(coordsFromText('https://maps.google.com/?q=-31.4,-64.2')).toEqual({ lat: -31.4, lng: -64.2 });
    expect(coordsFromText('https://maps.google.com/?q=-31.4%2C-64.2')).toEqual({ lat: -31.4, lng: -64.2 });
  });
  it('is null when there are none, or they are not coordinates', () => {
    expect(coordsFromText('https://maps.app.goo.gl/abc123')).toBeNull();
    expect(coordsFromText('https://www.google.com/maps/place/Algo')).toBeNull();
    expect(coordsFromText('@91.5,10.2')).toBeNull();
    expect(coordsFromText('@10.5,200.2')).toBeNull();
    expect(coordsFromText('@0.0,0.0')).toBeNull();
  });
});

describe('isAllowedMapUrl (the server only follows Google Maps links)', () => {
  it('lets Google Maps links through', () => {
    expect(isAllowedMapUrl('https://maps.app.goo.gl/abc123')).toBe(true);
    expect(isAllowedMapUrl('https://www.google.com/maps/place/Algo/@-31.4,-64.2,17z')).toBe(true);
    expect(isAllowedMapUrl('https://goo.gl/maps/xyz')).toBe(true);
  });
  it('refuses anything that could reach somewhere else', () => {
    expect(isAllowedMapUrl('http://maps.app.goo.gl/abc')).toBe(false); // not https
    expect(isAllowedMapUrl('https://localhost/maps')).toBe(false);
    expect(isAllowedMapUrl('https://127.0.0.1/maps')).toBe(false);
    expect(isAllowedMapUrl('https://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isAllowedMapUrl('https://google.com.evil.example/maps')).toBe(false);
    expect(isAllowedMapUrl('https://www.google.com@evil.example/maps')).toBe(false); // the real host is evil.example
    expect(isAllowedMapUrl('https://user:pass@www.google.com/maps')).toBe(false);
    expect(isAllowedMapUrl('https://www.google.com:8443/maps')).toBe(false);
    expect(isAllowedMapUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedMapUrl('not a url')).toBe(false);
  });
});

describe('knownGeo', () => {
  const e = { location: 'Club Central', mapUrl: 'https://maps.app.goo.gl/abc' };
  const key = geoKeyOf(e);
  it('is unknown until it has been worked out for this link and place', () => {
    expect(knownGeo({ ...e })).toBe('unknown');
    expect(knownGeo({ ...e, geo: { key: 'other', lat: -31.4, lng: -64.2 } })).toBe('unknown');
  });
  it('gives the coordinates when they were worked out for the current link and place', () => {
    expect(knownGeo({ ...e, geo: { key, lat: -31.4, lng: -64.2 } })).toEqual({ lat: -31.4, lng: -64.2 });
  });
  it('knows when it was tried and nothing was found, so it is not tried again', () => {
    expect(knownGeo({ ...e, geo: { key, failed: true } })).toBeNull();
  });
  it('a change of the place text or the link makes it unknown again', () => {
    const geo = { key, lat: -31.4, lng: -64.2 };
    expect(knownGeo({ location: 'Otro lugar', mapUrl: e.mapUrl, geo })).toBe('unknown');
    expect(knownGeo({ location: e.location, mapUrl: null, geo })).toBe('unknown');
  });
  it('the key ignores case and surrounding spaces of the place text', () => {
    expect(geoKeyOf({ location: ' Club Central ', mapUrl: null })).toBe(geoKeyOf({ location: 'club central', mapUrl: null }));
  });
});
