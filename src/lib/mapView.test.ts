import { describe, expect, it } from 'vitest';
import { CORDOBA_CENTER, distanceKm, startBounds } from './mapView';

const centerOf = (b: { south: number; north: number; west: number; east: number }) => ({ lat: (b.south + b.north) / 2, lng: (b.west + b.east) / 2 });
const VCP = { lat: -31.41838, lng: -64.4937 };
const ALBERDI = { lat: -31.41204, lng: -64.19594 };
const NUEVA_CBA = { lat: -31.42478, lng: -64.18997 };

describe('distanceKm', () => {
  it('is about 26 km from the center of Córdoba to Villa Carlos Paz, and 0 to itself', () => {
    expect(distanceKm(CORDOBA_CENTER, CORDOBA_CENTER)).toBe(0);
    const d = distanceKm(CORDOBA_CENTER, VCP);
    expect(d).toBeGreaterThan(25);
    expect(d).toBeLessThan(35);
  });
});

describe('startBounds', () => {
  it('is centered on the middle of Córdoba and holds the pins around it', () => {
    const b = startBounds([ALBERDI, NUEVA_CBA]);
    const c = centerOf(b);
    expect(c.lat).toBeCloseTo(CORDOBA_CENTER.lat, 6);
    expect(c.lng).toBeCloseTo(CORDOBA_CENTER.lng, 6);
    for (const p of [ALBERDI, NUEVA_CBA]) {
      expect(p.lat).toBeGreaterThanOrEqual(b.south);
      expect(p.lat).toBeLessThanOrEqual(b.north);
      expect(p.lng).toBeGreaterThanOrEqual(b.west);
      expect(p.lng).toBeLessThanOrEqual(b.east);
    }
  });

  it('ignores a pin far from the city: Villa Carlos Paz moves neither the center nor the zoom', () => {
    expect(startBounds([ALBERDI, NUEVA_CBA, VCP])).toEqual(startBounds([ALBERDI, NUEVA_CBA]));
  });

  it('does not zoom in to the street for a single pin by the center', () => {
    const b = startBounds([CORDOBA_CENTER]);
    expect(b.north - b.south).toBeGreaterThanOrEqual(0.02);
  });

  it('shows every pin when none is near the city', () => {
    const b = startBounds([VCP, { lat: -33.1, lng: -64.35 }]);
    expect(b.west).toBeCloseTo(VCP.lng, 6);
    expect(b.south).toBeCloseTo(-33.1, 6);
  });

  it('still gives a view over the city when there are no pins at all', () => {
    const c = centerOf(startBounds([]));
    expect(c.lat).toBeCloseTo(CORDOBA_CENTER.lat, 6);
  });
});
