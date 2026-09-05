"use client";

import { useEffect, useRef } from "react";
import maplibregl, { type Map as MlMap, type MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { ZoneFeature } from "@/lib/api";
import { FALLBACK_FRAME as FRAME } from "@/lib/camera";
import type { Lang } from "@/lib/i18n";
import { quantiseRisk, riskColor } from "@/lib/risk";
import type { ZoneNow } from "@/hooks/useZoneNow";

interface Props {
  zones: ZoneFeature[];
  states: Record<string, ZoneNow>;
  selected: string | null;
  onSelect: (id: string) => void;
  flyRequest: number;
  resetRequest: number;
  lang: Lang;
}

/**
 * Dark 2D fallback (MapLibre GL, CARTO raster basemap, no key) used when the Google Maps key
 * is missing or the 3D library fails. Same data, same colours, same interactions.
 */
export function FallbackMap({ zones, states, selected, onSelect, flyRequest, resetRequest, lang }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markers = useRef<Map<string, maplibregl.Marker>>(new Map());
  const zonesRef = useRef(zones);
  zonesRef.current = zones;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!container.current) return;
    const markerMap = markers.current;
    const map = new maplibregl.Map({
      container: container.current,
      style: {
        version: 8,
        sources: {
          carto: {
            type: "raster",
            tiles: [
              "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
              "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
              "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
            ],
            tileSize: 256,
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/">CARTO</a>',
          },
        },
        layers: [
          { id: "bg", type: "background", paint: { "background-color": "#0a0e1a", "background-opacity": 0 } },
          { id: "carto", type: "raster", source: "carto", paint: { "raster-opacity": 0.85, "raster-saturation": -0.2 } },
        ],
      },
      center: [FRAME.lng, FRAME.lat],
      zoom: FRAME.zoom,
      pitch: 48,
      bearing: -18,
      attributionControl: { compact: true },
      dragRotate: true,
    });
    mapRef.current = map;

    map.on("load", () => {
      map.addSource("zones", {
        type: "geojson",
        promoteId: "id",
        data: { type: "FeatureCollection", features: zonesRef.current },
      });
      map.addLayer({
        id: "zones-fill",
        type: "fill",
        source: "zones",
        paint: {
          "fill-color": ["coalesce", ["feature-state", "color"], "#22c55e"],
          "fill-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 0.55, 0.36],
        },
      });
      map.addLayer({
        id: "zones-line",
        type: "line",
        source: "zones",
        paint: {
          "line-color": ["case", ["boolean", ["feature-state", "selected"], false], "#ffffff", ["coalesce", ["feature-state", "color"], "#22c55e"]],
          "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 3, 1.6],
        },
      });
      map.on("click", "zones-fill", (e: MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id) onSelectRef.current(id);
      });
      map.on("mouseenter", "zones-fill", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "zones-fill", () => (map.getCanvas().style.cursor = ""));

      for (const z of zonesRef.current) {
        const el = document.createElement("div");
        el.className = "pointer-events-none select-none rounded px-1.5 py-0.5 text-[11px] font-medium text-white/90";
        el.style.textShadow = "0 1px 2px rgba(0,0,0,.9), 0 0 8px rgba(0,0,0,.6)";
        el.textContent = lang === "ar" ? z.properties.name_ar : z.properties.name_en;
        const m = new maplibregl.Marker({ element: el }).setLngLat(z.properties.centroid).addTo(map);
        markers.current.set(z.properties.id, m);
      }
      paint();
    });

    function paint() {
      if (!map.getSource("zones")) return;
      for (const z of zonesRef.current) {
        const id = z.properties.id;
        map.setFeatureState({ source: "zones", id }, { color: riskColor(quantiseRisk(statesRef.current[id]?.risk ?? 0)), selected: selectedRef.current === id });
      }
    }
    paintRef.current = paint;

    return () => {
      markerMap.clear();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statesRef = useRef(states);
  statesRef.current = states;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const paintRef = useRef<() => void>(() => {});

  useEffect(() => {
    paintRef.current();
  }, [states, selected]);

  // Keep source data + labels in step with the zones prop (it can arrive after mount).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource("zones") as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData({ type: "FeatureCollection", features: zones });
    for (const z of zones) {
      let m = markers.current.get(z.properties.id);
      if (!m) {
        const el = document.createElement("div");
        el.className = "pointer-events-none select-none rounded px-1.5 py-0.5 text-[11px] font-medium text-white/90";
        el.style.textShadow = "0 1px 2px rgba(0,0,0,.9), 0 0 8px rgba(0,0,0,.6)";
        m = new maplibregl.Marker({ element: el }).setLngLat(z.properties.centroid).addTo(map);
        markers.current.set(z.properties.id, m);
      }
      m.getElement().textContent = lang === "ar" ? z.properties.name_ar : z.properties.name_en;
    }
    paintRef.current();
  }, [lang, zones]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyRequest || !selected) return;
    const z = zones.find((f) => f.properties.id === selected);
    if (!z) return;
    map.flyTo({ center: z.properties.centroid, zoom: 13.2, pitch: 55, bearing: -10, duration: 2200, essential: true });
  }, [flyRequest, selected, zones]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !resetRequest) return;
    map.flyTo({ center: [FRAME.lng, FRAME.lat], zoom: FRAME.zoom, pitch: 48, bearing: -18, duration: 2200, essential: true });
  }, [resetRequest]);

  return <div ref={container} className="map-fill backdrop" />;
}
