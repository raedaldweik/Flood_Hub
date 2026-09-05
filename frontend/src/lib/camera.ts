/** Camera presets for Doha. Range in metres, tilt in degrees from nadir. */

export interface Camera {
  lat: number;
  lng: number;
  altitude?: number;
  range: number;
  tilt: number;
  heading: number;
}

/** Establishing shot: over the bay looking south-west across the whole city. */
export const ESTABLISHING: Camera = { lat: 25.275, lng: 51.525, altitude: 0, range: 19000, tilt: 58, heading: 205 };

export const CITY_CENTER = { lat: 25.285, lng: 51.531 };

/** 2D fallback framing: all twelve zones visible at 1080p with a 48° pitch. */
export const FALLBACK_FRAME = { lat: 25.245, lng: 51.52, zoom: 11.1 };

/** Pick a range that frames a zone from its area (km²) — tuned by eye at 1080p. */
export function zoneCamera(centroid: [number, number], areaKm2: number, heading = 25): Camera {
  const range = Math.min(9000, Math.max(2800, Math.sqrt(areaKm2) * 1900));
  return { lat: centroid[1], lng: centroid[0], altitude: 0, range, tilt: 64, heading };
}
