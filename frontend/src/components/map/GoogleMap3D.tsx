"use client";

import { useEffect, useRef } from "react";
import type { ZoneFeature } from "@/lib/api";
import { ESTABLISHING, zoneCamera, type Camera } from "@/lib/camera";
import { loadMaps3D } from "@/lib/googleMaps";
import { quantiseRisk, riskColor, riskColorAlpha } from "@/lib/risk";
import type { ZoneNow } from "@/hooks/useZoneNow";

interface Props {
  apiKey: string;
  zones: ZoneFeature[];
  states: Record<string, ZoneNow>;
  selected: string | null;
  onSelect: (id: string) => void;
  flyRequest: number;
  resetRequest: number;
  onReady: () => void;
  onError: (message: string) => void;
}

type Polygon = google.maps.maps3d.Polygon3DElement;

function toCamera(c: Camera): google.maps.maps3d.CameraOptions {
  return { center: { lat: c.lat, lng: c.lng, altitude: c.altitude ?? 0 }, range: c.range, tilt: c.tilt, heading: c.heading };
}

/**
 * Photorealistic 3D Doha (Map3DElement, HYBRID mode so Google's own district labels show).
 * Zones are draped Polygon3DInteractiveElements coloured by risk; the camera drifts slowly
 * around the establishing shot and flies to a zone on request.
 */
export function GoogleMap3D({ apiKey, zones, states, selected, onSelect, flyRequest, resetRequest, onReady, onError }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.maps3d.Map3DElement | null>(null);
  const polys = useRef<Map<string, Polygon>>(new Map());
  const lastColor = useRef<Map<string, string>>(new Map());
  const drifting = useRef(false);
  const libRef = useRef<google.maps.Maps3DLibrary | null>(null);
  const syncRef = useRef<() => void>(() => {});
  const zonesRef = useRef(zones);
  zonesRef.current = zones;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Mount once.
  useEffect(() => {
    let cancelled = false;
    const el = container.current;
    if (!el) return;
    const polyMap = polys.current;

    (async () => {
      try {
        const lib = await loadMaps3D(apiKey);
        if (cancelled) return;
        const map = new lib.Map3DElement({
          ...toCamera(ESTABLISHING),
          mode: "HYBRID",
          defaultUIHidden: true,
          gestureHandling: "GREEDY",
        });
        map.addEventListener("gmp-error", (e) => onError(`gmp-error: ${(e as Event).type}`));
        el.replaceChildren(map);
        mapRef.current = map;

        libRef.current = lib;
        syncPolygons();
        onReady();
        startDrift();
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
      }
    })();

    function syncPolygons() {
      const map = mapRef.current;
      const lib = libRef.current;
      if (!map || !lib) return;
      const PolyCtor = lib.Polygon3DInteractiveElement ?? lib.Polygon3DElement;
      for (const z of zonesRef.current) {
        if (polyMap.has(z.properties.id)) continue;
        const poly = new PolyCtor({
          altitudeMode: "CLAMP_TO_GROUND",
          fillColor: "rgba(34, 197, 94, 0.35)",
          strokeColor: "#22c55e",
          strokeWidth: 2,
          drawsOccludedSegments: true,
        });
        poly.path = z.geometry.coordinates[0].map(([lng, lat]) => ({ lat, lng }));
        poly.addEventListener("gmp-click", () => onSelectRef.current(z.properties.id));
        map.append(poly);
        polyMap.set(z.properties.id, poly);
      }
      lastColor.current.clear();
    }
    syncRef.current = syncPolygons;

    function startDrift() {
      const map = mapRef.current;
      if (!map || drifting.current) return;
      drifting.current = true;
      // A quarter turn over five minutes: alive, never distracting.
      map.flyCameraAround({ camera: toCamera(ESTABLISHING), durationMillis: 300_000, rounds: 0.25 });
    }

    return () => {
      cancelled = true;
      mapRef.current?.stopCameraAnimation();
      polyMap.clear();
      el.replaceChildren();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  // Zones can arrive after the map is ready.
  useEffect(() => {
    syncRef.current();
  }, [zones]);

  // Recolour polygons when risk moves (quantised to avoid churn at 20×).
  useEffect(() => {
    for (const [id, poly] of polys.current) {
      const risk = states[id]?.risk ?? 0;
      const q = quantiseRisk(risk);
      const key = `${q}|${selected === id ? 1 : 0}`;
      if (lastColor.current.get(id) === key) continue;
      lastColor.current.set(id, key);
      poly.fillColor = riskColorAlpha(q, selected === id ? 0.62 : 0.45);
      poly.strokeColor = selected === id ? "#ffffff" : riskColor(q);
      poly.strokeWidth = selected === id ? 3.5 : 2;
    }
  }, [states, selected]);

  // Fly to the selected zone.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyRequest || !selected) return;
    const z = zonesRef.current.find((f) => f.properties.id === selected);
    if (!z) return;
    drifting.current = false;
    map.stopCameraAnimation();
    map.flyCameraTo({ endCamera: toCamera(zoneCamera(z.properties.centroid, z.properties.area_km2)), durationMillis: 2600 });
  }, [flyRequest, selected]);

  // Return to the establishing shot and resume the drift.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !resetRequest) return;
    map.stopCameraAnimation();
    map.flyCameraTo({ endCamera: toCamera(ESTABLISHING), durationMillis: 2600 });
    const resume = () => {
      map.removeEventListener("gmp-animationend", resume);
      if (!drifting.current) {
        drifting.current = true;
        map.flyCameraAround({ camera: toCamera(ESTABLISHING), durationMillis: 300_000, rounds: 0.25 });
      }
    };
    map.addEventListener("gmp-animationend", resume);
  }, [resetRequest]);

  return <div ref={container} className="map-fill" />;
}
