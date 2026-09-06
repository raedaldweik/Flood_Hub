"use client";

import { useEffect, useRef } from "react";
import maplibregl, { type Map as MlMap, type MapMouseEvent, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { ZoneFeature } from "@/lib/api";
import { FALLBACK_FRAME as FRAME } from "@/lib/camera";
import type { Lang } from "@/lib/i18n";
import { BAND_COLORS, bandOf, quantiseRisk, riskColor } from "@/lib/risk";
import type { ZoneNow } from "@/hooks/useZoneNow";

interface Props {
  zones: ZoneFeature[];
  states: Record<string, ZoneNow>;
  selected: string | null;
  onSelect: (id: string) => void;
  flyRequest: number;
  resetRequest: number;
  lang: Lang;
  onBasemap?: (ok: boolean) => void;
}

/** CARTO's dark vector basemap (free with attribution, no key) — carries a `building` layer we extrude. */
const CARTO_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const OFFLINE_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#0a1020", "background-opacity": 0 } }],
};

async function loadStyle(): Promise<{ style: StyleSpecification; online: boolean }> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(CARTO_DARK, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(String(res.status));
    const style = (await res.json()) as StyleSpecification;
    // Tint the basemap into our midnight palette and mute label noise.
    for (const l of style.layers) {
      if (l.type === "background") l.paint = { ...(l.paint ?? {}), "background-color": "#0a1020" };
      if (l.type === "fill" && l.id.includes("water")) l.paint = { ...(l.paint ?? {}), "fill-color": "#0b1a33" };
    }
    return { style, online: true };
  } catch {
    return { style: OFFLINE_STYLE, online: false };
  }
}

/**
 * Cinematic 2D/2.5D fallback (MapLibre GL) used when the Google Maps key is missing or the 3D
 * library fails: dark vector basemap with extruded buildings, glowing risk zones that pulse when
 * red, and HUD labels with live scores. Same data, same colours, same interactions as the 3D map.
 */
export function FallbackMap({ zones, states, selected, onSelect, flyRequest, resetRequest, lang, onBasemap }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markers = useRef<Map<string, maplibregl.Marker>>(new Map());
  const zonesRef = useRef(zones);
  zonesRef.current = zones;
  const statesRef = useRef(states);
  statesRef.current = states;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const langRef = useRef(lang);
  langRef.current = lang;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const paintRef = useRef<() => void>(() => {});
  const loaded = useRef(false);

  useEffect(() => {
    if (!container.current) return;
    let disposed = false;
    let raf = 0;

    const map = new maplibregl.Map({
      container: container.current,
      style: OFFLINE_STYLE,
      center: [FRAME.lng, FRAME.lat],
      zoom: FRAME.zoom,
      pitch: 55,
      bearing: -15,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    const addOverlays = () => {
      if (map.getSource("zones")) return;
      map.addSource("zones", { type: "geojson", promoteId: "id", data: { type: "FeatureCollection", features: zonesRef.current } });

      // Extruded buildings when the vector basemap is present.
      if (map.getSource("carto") && !map.getLayer("sadd-buildings")) {
        const firstLabel = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
        map.addLayer(
          {
            id: "sadd-buildings",
            type: "fill-extrusion",
            source: "carto",
            "source-layer": "building",
            minzoom: 11,
            paint: {
              "fill-extrusion-color": ["interpolate", ["linear"], ["coalesce", ["get", "render_height"], 10], 0, "#151d33", 60, "#26314f", 200, "#3b4a6e"],
              "fill-extrusion-height": ["coalesce", ["get", "render_height"], 10],
              "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
              "fill-extrusion-opacity": 0.9,
            },
          },
          firstLabel,
        );
      }

      const color = ["coalesce", ["feature-state", "color"], BAND_COLORS.green] as unknown as string;
      const sel = ["boolean", ["feature-state", "selected"], false] as unknown as boolean;
      map.addLayer({
        id: "zones-glow",
        type: "line",
        source: "zones",
        paint: { "line-color": color, "line-width": 14, "line-blur": 12, "line-opacity": ["coalesce", ["feature-state", "glow"], 0.28] },
      });
      map.addLayer({
        id: "zones-fill",
        type: "fill",
        source: "zones",
        paint: { "fill-color": color, "fill-opacity": ["case", sel, 0.42, 0.26] },
      });
      map.addLayer({
        id: "zones-line",
        type: "line",
        source: "zones",
        paint: { "line-color": ["case", sel, "#ffffff", color], "line-width": ["case", sel, 3, 1.8], "line-opacity": 0.95 },
      });
      map.on("click", "zones-fill", (e: MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id) onSelectRef.current(id);
      });
      map.on("mouseenter", "zones-fill", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "zones-fill", () => (map.getCanvas().style.cursor = ""));
      loaded.current = true;
      syncLabels();
      paint();

      // Red zones breathe: a 1.8 s sine on the glow opacity through feature-state.
      const tick = (now: number) => {
        const pulse = 0.45 + 0.35 * Math.sin((now / 1800) * Math.PI * 2);
        for (const z of zonesRef.current) {
          const risk = statesRef.current[z.properties.id]?.risk ?? 0;
          const glow = risk >= 80 ? pulse : risk >= 60 ? 0.42 : 0.26;
          map.setFeatureState({ source: "zones", id: z.properties.id }, { glow });
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };

    function paint() {
      if (!map.getSource("zones")) return;
      for (const z of zonesRef.current) {
        const id = z.properties.id;
        map.setFeatureState({ source: "zones", id }, { color: riskColor(quantiseRisk(statesRef.current[id]?.risk ?? 0)), selected: selectedRef.current === id });
      }
      syncLabels();
    }
    paintRef.current = paint;

    function syncLabels() {
      for (const z of zonesRef.current) {
        const id = z.properties.id;
        let m = markers.current.get(id);
        if (!m) {
          const el = document.createElement("div");
          el.className = "hud-label";
          el.innerHTML = `<span class="hud-score"></span><span class="hud-name"></span>`;
          m = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(z.properties.centroid).addTo(map);
          markers.current.set(id, m);
        }
        const el = m.getElement();
        const risk = statesRef.current[id]?.risk ?? 0;
        const c = BAND_COLORS[bandOf(risk)];
        (el.querySelector(".hud-name") as HTMLElement).textContent = langRef.current === "ar" ? z.properties.name_ar : z.properties.name_en;
        const score = el.querySelector(".hud-score") as HTMLElement;
        score.textContent = String(Math.round(risk));
        score.style.background = c;
        el.style.borderColor = selectedRef.current === id ? "rgba(255,255,255,0.6)" : `${c}66`;
        el.style.boxShadow = risk >= 80 ? `0 0 16px ${c}88, 0 2px 10px rgba(0,0,0,.5)` : "0 2px 10px rgba(0,0,0,.45)";
        el.classList.toggle("sel", selectedRef.current === id);
      }
    }

    map.on("load", () => {
      // Swap to the vector basemap once it is fetched (never block on it).
      loadStyle().then(({ style, online }) => {
        if (disposed) return;
        onBasemap?.(online);
        if (!online) {
          addOverlays();
          return;
        }
        map.once("styledata", () => {
          const wait = () => (map.isStyleLoaded() ? addOverlays() : setTimeout(wait, 60));
          wait();
        });
        map.setStyle(style);
      });
    });

    const markerStore = markers.current;
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      markerStore.clear();
      map.remove();
      mapRef.current = null;
      loaded.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    paintRef.current();
  }, [states, selected, lang]);

  // Zones can arrive after mount.
  useEffect(() => {
    const map = mapRef.current;
    const src = map?.getSource("zones") as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData({ type: "FeatureCollection", features: zones });
    paintRef.current();
  }, [zones]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyRequest || !selected) return;
    const z = zones.find((f) => f.properties.id === selected);
    if (!z) return;
    map.flyTo({ center: z.properties.centroid, zoom: 13.4, pitch: 62, bearing: -12, duration: 2400, essential: true });
  }, [flyRequest, selected, zones]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !resetRequest) return;
    map.flyTo({ center: [FRAME.lng, FRAME.lat], zoom: FRAME.zoom, pitch: 55, bearing: -15, duration: 2400, essential: true });
  }, [resetRequest]);

  return <div ref={container} className="map-fill backdrop isolate" />;
}
