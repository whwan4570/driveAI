// Geometry for the Find my car view: where the parked car is relative to the way the camera faces.

export interface LatLon { lat: number; lon: number }

const RAD = Math.PI / 180;
const EARTH_RADIUS_M = 6_371_000;

export function distanceMeters(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial great-circle bearing from a to b, degrees clockwise from true north. */
export function bearingDegrees(a: LatLon, b: LatLon): number {
  const y = Math.sin((b.lon - a.lon) * RAD) * Math.cos(b.lat * RAD);
  const x = Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) - Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((b.lon - a.lon) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

/** Signed turn from the current heading to the target bearing, -180 (left) to 180 (right). */
export function relativeAngle(bearing: number, heading: number): number {
  return ((bearing - heading + 540) % 360) - 180;
}

export function compassPoint(degrees: number): string {
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(degrees / 45) % 8];
}

/**
 * Compass heading of the rear camera from W3C device orientation angles, when alpha is measured
 * from north (deviceorientationabsolute). Works with the phone held upright, not only flat.
 */
export function cameraHeading(alpha: number, beta: number, gamma: number): number {
  const a = alpha * RAD, b = beta * RAD, g = gamma * RAD;
  // The camera looks along the device's -z axis; project it onto the ground plane (east, north).
  const east = -Math.cos(a) * Math.sin(g) - Math.sin(a) * Math.sin(b) * Math.cos(g);
  const north = Math.cos(a) * Math.sin(b) * Math.cos(g) - Math.sin(a) * Math.sin(g);
  return (Math.atan2(east, north) / RAD + 360) % 360;
}

/** Smooths a compass reading without jumping across the 0/360 seam. */
export function smoothHeading(previous: number | null, next: number, weight = 0.2): number {
  if (previous === null) return next;
  return (previous + relativeAngle(next, previous) * weight + 360) % 360;
}

export function formatDistance(meters: number): string {
  const feet = meters * 3.28084;
  return feet < 1000 ? `${Math.round(feet / 10) * 10} ft` : `${(meters / 1609.344).toFixed(1)} mi`;
}
