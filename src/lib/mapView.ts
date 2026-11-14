import type { LatLng } from './geo';

/** The middle of the city of Córdoba (Plaza San Martín): where the map starts. */
export const CORDOBA_CENTER: LatLng = { lat: -31.4201, lng: -64.1888 };

/** Pins farther than this from the center are left out of the first view (they are still on the map, a pan away). */
export const START_RADIUS_KM = 15;

/** Distance in km between two points (haversine). */
export function distanceKm(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export type Bounds = { south: number; west: number; north: number; east: number };

/** Smallest half-side of the first view, in degrees (about 1 km), so a single pin next to the center does not zoom in to the street. */
const MIN_HALF_SIDE = 0.01;

/**
 * What the map shows when it opens: centered on the middle of Córdoba and wide enough for the pins around it.
 * A pin far from the city (Villa Carlos Paz, another province…) does not move the center or the zoom.
 * With no pin near the city, the first view is every pin, so nothing is left out of sight with an empty city on screen.
 */
export function startBounds(points: LatLng[], center: LatLng = CORDOBA_CENTER, radiusKm = START_RADIUS_KM): Bounds {
  const near = points.filter((p) => distanceKm(center, p) <= radiusKm);
  if (near.length === 0 && points.length > 0) {
    const lats = points.map((p) => p.lat);
    const lngs = points.map((p) => p.lng);
    return { south: Math.min(...lats), north: Math.max(...lats), west: Math.min(...lngs), east: Math.max(...lngs) };
  }
  // Symmetric around the center, so the center really is the middle of the screen
  const halfLat = Math.max(MIN_HALF_SIDE, ...near.map((p) => Math.abs(p.lat - center.lat)));
  const halfLng = Math.max(MIN_HALF_SIDE, ...near.map((p) => Math.abs(p.lng - center.lng)));
  return { south: center.lat - halfLat, north: center.lat + halfLat, west: center.lng - halfLng, east: center.lng + halfLng };
}
