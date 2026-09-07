"use client";

import { useEffect, useRef } from "react";
import type { Asset, BuildingFeature, ZoneFeature } from "@/lib/api";
import { CITY_CENTER, VECTOR_BAY, VECTOR_ESTABLISHING, vectorZoneView, type VectorView } from "@/lib/camera";
import { loadMapsLib } from "@/lib/googleMaps";
import { bandOf, quantiseRisk, riskColor } from "@/lib/risk";
import type { ZoneNow } from "@/hooks/useZoneNow";
import type { Lang } from "@/lib/i18n";
import { createFleetPin, FleetTween, paintFleetPin } from "./fleetPins";
import { createTowersOverlay, type TowersOverlay } from "./towersOverlay";

interface Props {
  apiKey: string;
  mapId: string;
  zones: ZoneFeature[];
  states: Record<string, ZoneNow>;
  selected: string | null;
  onSelect: (id: string) => void;
  flyRequest: number;
  resetRequest: number;
  skylineRequest: number;
  buildings: BuildingFeature[];
  showTowers: boolean;
  assets: Asset[];
  showFleet: boolean;
  lang: Lang;
  onReady: () => void;
  onError: (message: string) => void;
}

const DRIFT_DEG_PER_S = 0.6;

interface FleetLayer {
  sync: (assets: Asset[], show: boolean, lang: Lang) => void;
  dispose: () => void;
}

/** Fleet pins as AdvancedMarkerElements; re-tasked units glide to their new spot (FleetTween). */
function createFleetLayer(markerLib: google.maps.MarkerLibrary, map: google.maps.Map): FleetLayer {
  const pins = new Map<string, { marker: google.maps.marker.AdvancedMarkerElement; el: HTMLElement }>();
  const tween = new FleetTween();
  let raf = 0;
  const loop = (now: number) => {
    for (const id of tween.tick(now)) {
      const pos = tween.get(id);
      const pin = pins.get(id);
      if (pos && pin) pin.marker.position = pos;
    }
    raf = tween.animating ? requestAnimationFrame(loop) : 0;
  };
  return {
    sync(assets, show, lang) {
      const seen = new Set<string>();
      for (const a of assets) {
        seen.add(a.id);
        let pin = pins.get(a.id);
        const isNew = !pin;
        if (!pin) {
          const el = createFleetPin();
          const marker = new markerLib.AdvancedMarkerElement({ map: show ? map : null, content: el, position: { lat: a.lat, lng: a.lng }, zIndex: a.type === "pump_truck" ? 20 : 10 });
          pin = { marker, el };
          pins.set(a.id, pin);
        } else {
          pin.marker.map = show ? map : null;
        }
        paintFleetPin(pin.el, a, lang);
        tween.set(a.id, { lat: a.lat, lng: a.lng }, !isNew);
        if (isNew) pin.marker.position = { lat: a.lat, lng: a.lng };
      }
      for (const [id, pin] of pins) {
        if (!seen.has(id)) {
          pin.marker.map = null;
          pins.delete(id);
          tween.remove(id);
        }
      }
      if (tween.animating && !raf) raf = requestAnimationFrame(loop);
    },
    dispose() {
      cancelAnimationFrame(raf);
      for (const pin of pins.values()) pin.marker.map = null;
      pins.clear();
    },
  };
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpHeading = (a: number, b: number, t: number) => {
  const d = ((b - a + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
};

/**
 * Google's vector map (dark scheme, tilt + rotation, Google's own 3D buildings at district zoom)
 * with the zones as ground polygons and the OpenStreetMap towers extruded through a WebGL overlay.
 * Camera moves are our own eased tweens over `moveCamera`, so every transition is cinematic.
 */
export function GoogleVectorMap({
  apiKey, mapId, zones, states, selected, onSelect, flyRequest, resetRequest, skylineRequest, buildings, showTowers, assets, showFleet, lang, onReady, onError,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const libRef = useRef<google.maps.MapsLibrary | null>(null);
  const polys = useRef<Map<string, google.maps.Polygon>>(new Map());
  const lastColor = useRef<Map<string, string>>(new Map());
  const towersRef = useRef<TowersOverlay | null>(null);
  const fleetRef = useRef<FleetLayer | null>(null);
  const fleetArgs = useRef({ assets, showFleet, lang });
  fleetArgs.current = { assets, showFleet, lang };
  const tweenRaf = useRef(0);
  const driftRaf = useRef(0);
  const drifting = useRef(false);
  const statesRef = useRef(states);
  statesRef.current = states;
  const zonesRef = useRef(zones);
  zonesRef.current = zones;
  const buildingsRef = useRef(buildings);
  buildingsRef.current = buildings;
  const showTowersRef = useRef(showTowers);
  showTowersRef.current = showTowers;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const syncRef = useRef<() => void>(() => {});

  const paintTowers = () => {
    towersRef.current?.paint((zone) => bandOf(statesRef.current[zone]?.risk ?? 0));
  };

  const stopDrift = () => {
    drifting.current = false;
    cancelAnimationFrame(driftRaf.current);
  };

  const startDrift = () => {
    const map = mapRef.current;
    if (!map || drifting.current) return;
    drifting.current = true;
    let last = performance.now();
    const step = (now: number) => {
      if (!drifting.current) return;
      const dt = (now - last) / 1000;
      last = now;
      map.moveCamera({ heading: ((map.getHeading() ?? 0) + DRIFT_DEG_PER_S * dt) % 360 });
      driftRaf.current = requestAnimationFrame(step);
    };
    driftRaf.current = requestAnimationFrame(step);
  };

  const flyTo = (view: VectorView, ms: number, onDone?: () => void) => {
    const map = mapRef.current;
    if (!map) return;
    stopDrift();
    cancelAnimationFrame(tweenRaf.current);
    const c = map.getCenter();
    const from = {
      lat: c?.lat() ?? view.lat, lng: c?.lng() ?? view.lng,
      zoom: map.getZoom() ?? view.zoom, tilt: map.getTilt() ?? view.tilt, heading: map.getHeading() ?? view.heading,
    };
    const t0 = performance.now();
    const step = (now: number) => {
      const t = easeInOut(Math.min(1, (now - t0) / ms));
      map.moveCamera({
        center: { lat: lerp(from.lat, view.lat, t), lng: lerp(from.lng, view.lng, t) },
        zoom: lerp(from.zoom, view.zoom, t),
        tilt: lerp(from.tilt, view.tilt, t),
        heading: lerpHeading(from.heading, view.heading, t),
      });
      if (t < 1) tweenRaf.current = requestAnimationFrame(step);
      else onDone?.();
    };
    tweenRaf.current = requestAnimationFrame(step);
  };

  // Mount once.
  useEffect(() => {
    let cancelled = false;
    const el = container.current;
    if (!el) return;
    const polyMap = polys.current;
    const lastColorMap = lastColor.current;

    (async () => {
      try {
        const lib = await loadMapsLib(apiKey);
        if (cancelled) return;
        const v = VECTOR_ESTABLISHING;
        const map = new lib.Map(el, {
          mapId,
          renderingType: "VECTOR",
          colorScheme: "DARK",
          center: { lat: v.lat, lng: v.lng },
          zoom: v.zoom,
          tilt: v.tilt,
          heading: v.heading,
          disableDefaultUI: true,
          gestureHandling: "greedy",
          isFractionalZoomEnabled: true,
          headingInteractionEnabled: true,
          tiltInteractionEnabled: true,
          clickableIcons: false,
          keyboardShortcuts: false,
          backgroundColor: "#070b15",
        });
        mapRef.current = map;
        libRef.current = lib;
        console.info("[sadd] map engine: vector (Map ID", mapId + ")");

        // 3D buildings need vector rendering; RASTER means the Map ID (or the device) cannot do it.
        map.addListener("renderingtype_changed", () => {
          if ((map.getRenderingType() as string) === "RASTER") onError("vector rendering unavailable — check NEXT_PUBLIC_GOOGLE_MAP_ID");
        });
        const first = map.addListener("idle", () => {
          first.remove();
          if (cancelled) return;
          onReady();
          startDrift();
        });

        const towers = createTowersOverlay(lib, CITY_CENTER);
        towers.overlay.setMap(map);
        towersRef.current = towers;
        if (buildingsRef.current.length) towers.setBuildings(buildingsRef.current);
        towers.setVisible(showTowersRef.current);

        syncPolygons();
        paintTowers();

        // Fleet pins need the marker library (loaded lazily; a failure here must not sink the map).
        try {
          const markerLib = (await google.maps.importLibrary("marker")) as google.maps.MarkerLibrary;
          if (cancelled) return;
          fleetRef.current = createFleetLayer(markerLib, map);
          const f = fleetArgs.current;
          fleetRef.current.sync(f.assets, f.showFleet, f.lang);
        } catch (err) {
          console.warn("[sadd] fleet markers unavailable:", err);
        }
        el.addEventListener("pointerdown", stopDrift);
        el.addEventListener("wheel", stopDrift, { passive: true });
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
      }
    })();

    function syncPolygons() {
      const map = mapRef.current;
      const lib = libRef.current;
      if (!map || !lib) return;
      for (const z of zonesRef.current) {
        if (polyMap.has(z.properties.id)) continue;
        const poly = new lib.Polygon({
          paths: z.geometry.coordinates[0].map(([lng, lat]) => ({ lat, lng })),
          fillColor: "#22c55e",
          fillOpacity: 0.1,
          strokeColor: "#22c55e",
          strokeOpacity: 0.9,
          strokeWeight: 1.5,
          clickable: true,
          zIndex: 1,
          map,
        });
        poly.addListener("click", () => onSelectRef.current(z.properties.id));
        polyMap.set(z.properties.id, poly);
      }
      lastColorMap.clear();
    }
    syncRef.current = syncPolygons;

    return () => {
      cancelled = true;
      stopDrift();
      cancelAnimationFrame(tweenRaf.current);
      towersRef.current?.dispose();
      towersRef.current = null;
      fleetRef.current?.dispose();
      fleetRef.current = null;
      for (const p of polyMap.values()) p.setMap(null);
      polyMap.clear();
      el.removeEventListener("pointerdown", stopDrift);
      el.removeEventListener("wheel", stopDrift);
      el.replaceChildren();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, mapId]);

  // Zones can arrive after the map is ready.
  useEffect(() => {
    syncRef.current();
  }, [zones]);

  // Towers arrive once the backend reports ready.
  useEffect(() => {
    towersRef.current?.setBuildings(buildings);
    paintTowers();
  }, [buildings]);

  useEffect(() => {
    towersRef.current?.setVisible(showTowers);
  }, [showTowers]);

  // Fleet positions change only through the rules engine (approve / stand-down); pins glide there.
  useEffect(() => {
    fleetRef.current?.sync(assets, showFleet, lang);
  }, [assets, showFleet, lang]);

  // Recolour zones + towers when risk moves (quantised so 20× playback stays cheap).
  useEffect(() => {
    for (const [id, poly] of polys.current) {
      const q = quantiseRisk(states[id]?.risk ?? 0);
      const isSel = selected === id;
      const key = `${q}|${isSel ? 1 : 0}`;
      if (lastColor.current.get(id) === key) continue;
      lastColor.current.set(id, key);
      // Outline carries the colour; the fill stays a tint so Google's buildings show through.
      const fill = q >= 80 ? 0.34 : q >= 60 ? 0.26 : q >= 40 ? 0.18 : 0.1;
      poly.setOptions({
        fillColor: riskColor(q),
        fillOpacity: isSel ? Math.max(0.3, fill) : fill,
        strokeColor: isSel ? "#ffffff" : riskColor(q),
        strokeWeight: isSel ? 3 : q >= 40 ? 2.2 : 1.5,
      });
    }
    paintTowers();
  }, [states, selected]);

  // Fly to the selected zone.
  useEffect(() => {
    if (!flyRequest || !selected) return;
    const z = zonesRef.current.find((f) => f.properties.id === selected);
    if (z) flyTo(vectorZoneView(z.properties.centroid, z.properties.area_km2), 2600);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyRequest, selected]);

  // Bay view: West Bay towers, close enough for Google's own 3D buildings.
  useEffect(() => {
    if (skylineRequest) flyTo(VECTOR_BAY, 3400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skylineRequest]);

  // Back to the establishing shot, then resume the slow drift.
  useEffect(() => {
    if (resetRequest) flyTo(VECTOR_ESTABLISHING, 2600, startDrift);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetRequest]);

  return <div ref={container} className="map-fill isolate" />;
}
