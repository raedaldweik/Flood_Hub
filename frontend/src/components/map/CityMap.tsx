"use client";

import { useState } from "react";
import { Box, WifiOff } from "lucide-react";
import type { ZoneFeature } from "@/lib/api";
import { MAPS_KEY } from "@/lib/googleMaps";
import { t } from "@/lib/i18n";
import { useUi } from "@/lib/store";
import type { ZoneNow } from "@/hooks/useZoneNow";
import { GoogleMap3D } from "./GoogleMap3D";
import { FallbackMap } from "./FallbackMap";

interface Props {
  zones: ZoneFeature[];
  states: Record<string, ZoneNow>;
}

/**
 * Picks the renderer: photorealistic 3D when a Google Maps key is present and loads;
 * the cinematic MapLibre fallback otherwise — with an honest banner saying why (CLAUDE.md §11).
 */
export function CityMap({ zones, states }: Props) {
  const lang = useUi((s) => s.lang);
  const selected = useUi((s) => s.selectedZone);
  const requestFly = useUi((s) => s.requestFly);
  const flyRequest = useUi((s) => s.flyRequest);
  const resetRequest = useUi((s) => s.resetRequest);
  const skylineRequest = useUi((s) => s.skylineRequest);

  const [threeD, setThreeD] = useState<"loading" | "ready" | "failed">(MAPS_KEY ? "loading" : "failed");
  const [failure, setFailure] = useState<string | null>(MAPS_KEY ? null : "missing-key");
  const [basemap, setBasemap] = useState<boolean | null>(null);

  const use3D = Boolean(MAPS_KEY) && threeD !== "failed";

  return (
    <div className="absolute inset-0 isolate overflow-hidden">
      {use3D ? (
        <GoogleMap3D
          apiKey={MAPS_KEY}
          zones={zones}
          states={states}
          selected={selected}
          onSelect={requestFly}
          flyRequest={flyRequest}
          resetRequest={resetRequest}
          skylineRequest={skylineRequest}
          onReady={() => setThreeD("ready")}
          onError={(m) => {
            console.warn("[sadd] 3D map unavailable:", m);
            setFailure(m);
            setThreeD("failed");
          }}
        />
      ) : (
        <FallbackMap
          zones={zones}
          states={states}
          selected={selected}
          onSelect={requestFly}
          flyRequest={flyRequest}
          resetRequest={resetRequest}
          skylineRequest={skylineRequest}
          lang={lang}
          onBasemap={setBasemap}
        />
      )}
      <div className="map-vignette" />

      {use3D && threeD === "loading" && (
        <div className="backdrop absolute inset-0 grid place-items-center">
          <div className="flex items-center gap-3 text-[13px] font-semibold text-fg-2">
            <span className="h-2 w-2 animate-ping rounded-full bg-accent" />
            {t(lang, "map_loading")}
          </div>
        </div>
      )}

      {!use3D && (
        <div className="pointer-events-none absolute bottom-[152px] end-3.5 z-10 flex flex-col items-end gap-2">
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
