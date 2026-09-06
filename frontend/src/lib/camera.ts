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

/**
 * Bay view: the Corniche and West Bay from 5 km, camera to the south-east looking over the towers
 * to the Gulf. Google's photorealistic mesh does not cover Qatar (verified on the live key: flat
 * imagery at every range, no Map Tiles errors), so the map is satellite imagery draped on terrain.
 * Oblique imagery still reads well from this height; closer only exposes the flatness.
 */
export const SKYLINE: Camera = { lat: 25.3185, lng: 51.5295, altitude: 0, range: 5200, tilt: 62, heading: 330 };
export const SKYLINE_FRAME = { lat: 25.3185, lng: 51.5295, zoom: 13.2, pitch: 60, bearing: -30 };

/** 2D fallback framing: all twelve zones visible at 1080p with a 48° pitch. */
export const FALLBACK_FRAME = { lat: 25.242, lng: 51.525, zoom: 11.55 };

/** Pick a range that frames a zone from its area (km²) — tuned by eye at 1080p. */
export function zoneCamera(centroid: [number, number], areaKm2: number, heading = 25): Camera {
  const range = Math.min(9000, Math.max(2800, Math.sqrt(areaKm2) * 1900));
  return { lat: centroid[1], lng: centroid[0], altitude: 0, range, tilt: 64, heading };
}

/* ── Vector engine (google.maps.Map, tilt/heading/zoom) ─────────────────────────────────────── */

export interface VectorView {
  lat: number;
  lng: number;
  zoom: number;
  tilt: number;
  heading: number;
}

/** Establishing shot on the vector map: whole city, tilted, looking north over the bay. */
export const VECTOR_ESTABLISHING: VectorView = { lat: 25.292, lng: 51.53, zoom: 12.35, tilt: 62, heading: 20 };

/** Bay view: West Bay towers from the south-east — close enough for Google's own 3D buildings. */
export const VECTOR_BAY: VectorView = { lat: 25.3185, lng: 51.5295, zoom: 15.3, tilt: 67.5, heading: 330 };

/** Frame a zone from its area (km²): bigger districts sit further out. */
export function vectorZoneView(centroid: [number, number], areaKm2: number, heading = 25): VectorView {
  const zoom = Math.min(15.8, Math.max(13.5, 15.2 - Math.log2(Math.sqrt(Math.max(areaKm2, 0.25)) / 1.6)));
  return { lat: centroid[1], lng: centroid[0], zoom, tilt: 65, heading };
}
