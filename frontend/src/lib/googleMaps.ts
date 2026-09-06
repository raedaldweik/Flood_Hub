/**
 * Loads the Maps JavaScript API once (official bootstrap loader, inlined) and returns the
 * `maps3d` library. Photorealistic 3D needs BOTH "Maps JavaScript API" and "Map Tiles API"
 * enabled on the key's project (CLAUDE.md §12.1).
 */

declare global {
  interface Window {
    google?: typeof google;
    __saddMapsLoading?: Promise<void>;
  }
}

export const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? "";
/**
 * Map ID for the vector engine (3D buildings, tilt, rotation). Google's public DEMO_MAP_ID works for
 * any key; a project Map ID lets you attach a cloud-styled dark theme (docs/DEPLOY_RAILWAY.md).
 */
export const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID || "DEMO_MAP_ID";
/**
 * Which Google engine starts first. "vector" = dark vector map with 3D buildings + three.js towers;
 * "3d" = photorealistic Map3DElement. The vector engine flips to default once it is verified on a
 * live key; until then it is opt-in so a deploy never changes the demo unseen.
 */
export const MAP_ENGINE: "vector" | "3d" = process.env.NEXT_PUBLIC_MAP_ENGINE === "vector" ? "vector" : "3d";

function bootstrap(key: string): Promise<void> {
  if (window.google?.maps) return Promise.resolve();
  if (window.__saddMapsLoading) return window.__saddMapsLoading;
  window.__saddMapsLoading = new Promise<void>((resolve, reject) => {
    const params = new URLSearchParams({ key, v: "beta", loading: "async", callback: "__saddMapsReady" });
    (window as unknown as Record<string, unknown>).__saddMapsReady = () => resolve();
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    s.async = true;
    s.onerror = () => reject(new Error("Maps JavaScript API failed to load (network or key restriction)"));
    document.head.appendChild(s);
    setTimeout(() => reject(new Error("Maps JavaScript API load timed out")), 20000);
  });
  return window.__saddMapsLoading;
}

export async function loadMaps3D(key: string): Promise<google.maps.Maps3DLibrary> {
  await bootstrap(key);
  return (await google.maps.importLibrary("maps3d")) as google.maps.Maps3DLibrary;
}

export async function loadMapsLib(key: string): Promise<google.maps.MapsLibrary> {
  await bootstrap(key);
  return (await google.maps.importLibrary("maps")) as google.maps.MapsLibrary;
}
