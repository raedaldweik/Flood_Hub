"use client";

import { useState } from "react";
import { Box, Building2, Truck, WifiOff } from "lucide-react";
import type { Asset, ZoneFeature } from "@/lib/api";
import { MAP_ENGINE, MAP_ID, MAPS_KEY } from "@/lib/googleMaps";
import { t } from "@/lib/i18n";
import { useUi } from "@/lib/store";
import { useBuildings } from "@/hooks/useData";
import type { ZoneNow } from "@/hooks/useZoneNow";
import { GoogleVectorMap } from "./GoogleVectorMap";
import { GoogleMap3D } from "./GoogleMap3D";
import { FallbackMap } from "./FallbackMap";

interface Props {
  zones: ZoneFeature[];
  states: Record<string, ZoneNow>;
  /** Fleet pins (pump trucks + tankers). Omit to hide the layer and its toggle. */
  assets?: Asset[];
  /** Where the toggles sit — the Command Center keeps them above its time controls. */
  chromeBottom?: number;
}

/**
 * Engine chain, each step honest about why it stepped down (CLAUDE.md §11):
 *   vector   — Google's dark vector map with its own 3D buildings + our risk-lit towers (default)
 *   3d       — Google's photorealistic Map3DElement (imagery on terrain; Qatar has no mesh yet)
 *   fallback — cinematic MapLibre map, for a missing key or a blocked Google endpoint
 */
type Engine = "vector" | "3d" | "fallback";

export function CityMap({ zones, states, assets, chromeBottom = 152 }: Props) {
  const lang = useUi((s) => s.lang);
  const fleetOn = useUi((s) => s.fleet);
  const setFleet = useUi((s) => s.setFleet);
  const selected = useUi((s) => s.selectedZone);
  const requestFly = useUi((s) => s.requestFly);
  const flyRequest = useUi((s) => s.flyRequest);
  const resetRequest = useUi((s) => s.resetRequest);
  const towers = useUi((s) => s.towers);
  const setTowers = useUi((s) => s.setTowers);
  const skylineRequest = useUi((s) => s.skylineRequest);

  const [engine, setEngine] = useState<Engine>(MAPS_KEY ? MAP_ENGINE : "fallback");
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<string | null>(MAPS_KEY ? null : "missing-key");
  const [basemap, setBasemap] = useState<boolean | null>(null);

  const google = engine !== "fallback";
  // Risk-lit towers (OpenStreetMap footprints) — fetched once a Google engine is up.
  const { data: buildings } = useBuildings(google && ready);
  const towerCount = buildings?.features.length ?? 0;

  const stepDown = (from: Engine, message: string) => {
    console.warn(`[sadd] ${from} map unavailable, stepping down:`, message);
    setFailure(message);
    setReady(false);
    setEngine(from === "vector" ? "3d" : "fallback");
  };

  const shared = {
    apiKey: MAPS_KEY,
    zones,
    states,
    selected,
    onSelect: requestFly,
    flyRequest,
    resetRequest,
    skylineRequest,
    buildings: buildings?.features ?? [],
    showTowers: towers,
    assets: assets ?? [],
    showFleet: fleetOn && Boolean(assets),
    lang,
    onReady: () => setReady(true),
  };

  return (
    <div className="absolute inset-0 isolate overflow-hidden">
      {engine === "vector" && <GoogleVectorMap {...shared} mapId={MAP_ID} onError={(m) => stepDown("vector", m)} />}
      {engine === "3d" && <GoogleMap3D {...shared} onError={(m) => stepDown("3d", m)} />}
      {engine === "fallback" && (
        <FallbackMap
          zones={zones}
          states={states}
          selected={selected}
          onSelect={requestFly}
          flyRequest={flyRequest}
          resetRequest={resetRequest}
          skylineRequest={skylineRequest}
          lang={lang}
          assets={assets ?? []}
          showFleet={fleetOn && Boolean(assets)}
          onBasemap={setBasemap}
        />
      )}
      <div className="map-vignette" />

      {google && !ready && (
        <div className="backdrop absolute inset-0 grid place-items-center">
          <div className="flex items-center gap-3 text-[13px] font-semibold text-fg-2">
            <span className="h-2 w-2 animate-ping rounded-full bg-accent" />
            {t(lang, "map_loading")}
          </div>
        </div>
      )}

      {google && ready && (
        <div className="pointer-events-none absolute end-3.5 z-10 flex flex-col items-end gap-2" style={{ bottom: chromeBottom }}>
          {assets && <FleetPill count={assets.length} on={fleetOn} toggle={() => setFleet(!fleetOn)} label={t(lang, "map_fleet")} />}
          {towerCount > 0 && (
            <button
              type="button"
              onClick={() => setTowers(!towers)}
              className="status-pill pointer-events-auto text-fg-2 transition-colors hover:text-fg"
              title={t(lang, "map_towers_src")}
            >
              <Building2 size={13} className={towers ? "text-accent" : "text-muted"} />
              {t(lang, "map_towers")} · {towerCount} · {t(lang, "map_towers_src")}
              <span className={`ms-1 h-1.5 w-1.5 rounded-full ${towers ? "bg-accent" : "bg-white/30"}`} />
            </button>
          )}
          <div className="status-pill text-fg-2">
            <Box size={13} className="text-accent" />
            {t(lang, engine === "vector" ? "map_engine_vector" : "map_3d_no_mesh")}
          </div>
        </div>
      )}

      {engine === "fallback" && (
        <div className="pointer-events-none absolute end-3.5 z-10 flex flex-col items-end gap-2" style={{ bottom: chromeBottom }}>
          {assets && <FleetPill count={assets.length} on={fleetOn} toggle={() => setFleet(!fleetOn)} label={t(lang, "map_fleet")} />}
          <div className="status-pill text-fg-2">
            <Box size={13} className="text-accent" />
            {failure === "missing-key" ? t(lang, "map_3d_missing") : t(lang, "map_3d_error")}
          </div>
          {basemap === false && (
            <div className="status-pill text-orange">
              <WifiOff size={13} />
              {t(lang, "map_offline")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FleetPill({ count, on, toggle, label }: { count: number; on: boolean; toggle: () => void; label: string }) {
  return (
    <button type="button" onClick={toggle} className="status-pill pointer-events-auto text-fg-2 transition-colors hover:text-fg">
      <Truck size={13} className={on ? "text-accent" : "text-muted"} />
      {label} · {count}
      <span className={`ms-1 h-1.5 w-1.5 rounded-full ${on ? "bg-accent" : "bg-white/30"}`} />
    </button>
  );
}
