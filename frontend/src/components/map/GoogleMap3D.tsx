"use client";

import { useEffect, useRef } from "react";
import type { Asset, BuildingFeature, ZoneFeature } from "@/lib/api";
import { ESTABLISHING, SKYLINE, zoneCamera, type Camera } from "@/lib/camera";
import { loadMaps3D } from "@/lib/googleMaps";
import { quantiseRisk, riskColor, riskColorAlpha } from "@/lib/risk";
import type { ZoneNow } from "@/hooks/useZoneNow";
import type { Lang } from "@/lib/i18n";
import { FLEET_COLORS } from "./fleetPins";

interface Props {
  apiKey: string;
  zones: ZoneFeature[];
  states: Record<string, ZoneNow>;
  selected: string | null;
  onSelect: (id: string) => void;
  flyRequest: number;
  resetRequest: number;
  skylineRequest: number;
  /** Risk-lit towers: OSM footprints extruded to their height, lit by their zone's risk. */
  buildings: BuildingFeature[];
  showTowers: boolean;
  assets: Asset[];
  showFleet: boolean;
  lang: Lang;
  onReady: () => void;
  onError: (message: string) => void;
}

type Polygon = google.maps.maps3d.Polygon3DElement;
type Tower = { el: Polygon; zone: string | null };

// Calm glass for towers in normal zones; risk colours take over from the yellow band up.
const TOWER_GLASS_FILL = "rgba(125, 211, 252, 0.14)";
const TOWER_GLASS_STROKE = "rgba(186, 230, 253, 0.32)";
const TOWER_BATCH = 40; // polygons created per frame so a 400-tower skyline never freezes one

function toCamera(c: Camera): google.maps.maps3d.CameraOptions {
  return { center: { lat: c.lat, lng: c.lng, altitude: c.altitude ?? 0 }, range: c.range, tilt: c.tilt, heading: c.heading };
}

// A quarter turn over five minutes: alive, never distracting. `repeatCount` is the runtime's
// current name for the (deprecated) `rounds` option; the typings still lag behind it.
const ORBIT = {
  camera: toCamera(ESTABLISHING),
  durationMillis: 300_000,
  repeatCount: 0.25,
} as google.maps.maps3d.FlyAroundAnimationOptions;

/**
 * Photorealistic 3D Doha (Map3DElement, HYBRID mode so Google's own district labels show).
 * Zones are draped Polygon3DInteractiveElements coloured by risk; the camera drifts slowly
 * around the establishing shot and flies to a zone on request.
 */
export function GoogleMap3D({
  apiKey, zones, states, selected, onSelect, flyRequest, resetRequest, skylineRequest, buildings, showTowers, assets, showFleet, lang, onReady, onError,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.maps3d.Map3DElement | null>(null);
  const polys = useRef<Map<string, Polygon>>(new Map());
  const lastColor = useRef<Map<string, string>>(new Map());
  const towers = useRef<Map<number, Tower>>(new Map());
  const fleet = useRef<Map<string, google.maps.maps3d.Marker3DElement>>(new Map());
  const towerColor = useRef<Map<number, string>>(new Map());
  const buildingsRef = useRef(buildings);
  buildingsRef.current = buildings;
  const showTowersRef = useRef(showTowers);
  showTowersRef.current = showTowers;
  const statesRef = useRef(states);
  statesRef.current = states;
  const syncTowersRef = useRef<() => void>(() => {});
  const drifting = useRef(false);
  const libRef = useRef<google.maps.Maps3DLibrary | null>(null);
  const syncRef = useRef<() => void>(() => {});
  const paintTowersRef = useRef<() => void>(() => {});
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
    const towerMap = towers.current;
    const towerColorMap = towerColor.current;
    const fleetMap = fleet.current;

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
        syncTowers();
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

    function paintTowers() {
      for (const [id, { el, zone }] of towerMap) {
        const risk = zone ? (statesRef.current[zone]?.risk ?? 0) : 0;
        const q = quantiseRisk(risk);
        const key = q < 40 ? "glass" : String(q);
        if (towerColorMap.get(id) === key) continue;
        towerColorMap.set(id, key);
        if (key === "glass") {
          el.fillColor = TOWER_GLASS_FILL;
          el.strokeColor = TOWER_GLASS_STROKE;
        } else {
          el.fillColor = riskColorAlpha(q, q >= 60 ? 0.62 : 0.5);
          el.strokeColor = riskColorAlpha(q, 0.9);
        }
      }
    }

    function syncTowers() {
      const map = mapRef.current;
      const lib = libRef.current;
      if (!map || !lib) return;
      const pending = buildingsRef.current.filter((b) => !towerMap.has(b.properties.osm_id));
      if (!pending.length) return;
      let i = 0;
      const step = () => {
        if (cancelled || mapRef.current !== map) return;
        for (const b of pending.slice(i, i + TOWER_BATCH)) {
          const ring = b.geometry.coordinates[0] ?? [];
          const el = new lib.Polygon3DElement({
            altitudeMode: "RELATIVE_TO_GROUND",
            extruded: true,
            fillColor: TOWER_GLASS_FILL,
            strokeColor: TOWER_GLASS_STROKE,
            strokeWidth: 1,
            drawsOccludedSegments: false,
          });
          // The runtime deprecates `outerCoordinates` in favour of `path` (the typings say the reverse).
          el.path = ring.map(([lng, lat]) => ({ lat: lat!, lng: lng!, altitude: b.properties.height_m }));
          towerMap.set(b.properties.osm_id, { el, zone: b.properties.zone_id });
          if (showTowersRef.current) map.append(el);
        }
        i += TOWER_BATCH;
        paintTowers();
        if (i < pending.length) setTimeout(step, 16);
      };
      step();
    }
    syncTowersRef.current = syncTowers;
    paintTowersRef.current = paintTowers;

    function startDrift() {
      const map = mapRef.current;
      if (!map || drifting.current) return;
      drifting.current = true;
      map.flyCameraAround(ORBIT);
    }

    return () => {
      cancelled = true;
      mapRef.current?.stopCameraAnimation();
      polyMap.clear();
      towerMap.clear();
      towerColorMap.clear();
      fleetMap.clear();
      el.replaceChildren();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  // Zones can arrive after the map is ready.
  useEffect(() => {
    syncRef.current();
  }, [zones]);

  // Towers arrive after the map is ready (fetched once 3D is up).
  useEffect(() => {
    syncTowersRef.current();
  }, [buildings]);

  // Light the towers by their zone's risk; only touched when a zone's quantised band moves.
  useEffect(() => {
    paintTowersRef.current();
  }, [states]);

  // Fleet pins on the photorealistic map: Marker3DElements, coloured by status (no tween on this engine).
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!map || !lib || !lib.Marker3DElement) return;
    const seen = new Set<string>();
    for (const a of assets) {
      seen.add(a.id);
      let m = fleet.current.get(a.id);
      if (!m) {
        m = new lib.Marker3DElement({ altitudeMode: "RELATIVE_TO_GROUND", extruded: true, sizePreserved: true });
        fleet.current.set(a.id, m);
      }
      m.position = { lat: a.lat, lng: a.lng, altitude: 30 };
      m.label = lang === "ar" ? a.callsign_ar : a.callsign;
      m.style.setProperty("--gmp-marker-color", FLEET_COLORS[a.status] ?? FLEET_COLORS.idle);
      if (showFleet) {
        if (!m.isConnected) map.append(m);
      } else {
        m.remove();
      }
    }
    for (const [id, m] of fleet.current) {
      if (!seen.has(id)) {
        m.remove();
        fleet.current.delete(id);
      }
    }
  }, [assets, showFleet, lang]);

  // Layer toggle: detach or re-attach every tower element.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const { el } of towers.current.values()) {
      if (showTowers) {
        if (!el.isConnected) map.append(el);
      } else {
        el.remove();
      }
    }
  }, [showTowers]);

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

  // Bay view over West Bay and the Corniche (see SKYLINE for why it stays at 5 km).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !skylineRequest) return;
    drifting.current = false;
    map.stopCameraAnimation();
    map.flyCameraTo({ endCamera: toCamera(SKYLINE), durationMillis: 3400 });
  }, [skylineRequest]);

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
        map.flyCameraAround(ORBIT);
      }
    };
    map.addEventListener("gmp-animationend", resume);
  }, [resetRequest]);

  return <div ref={container} className="map-fill isolate" />;
}
