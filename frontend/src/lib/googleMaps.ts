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
