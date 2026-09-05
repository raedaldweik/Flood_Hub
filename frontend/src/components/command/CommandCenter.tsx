"use client";

import { useEffect, useMemo } from "react";
import { AlertOctagon } from "lucide-react";
import { useAlerts, useAssets, useLiveState, useLiveWeather, useMeta, useTimeline, useZones } from "@/hooks/useData";
import { usePlayback } from "@/hooks/usePlayback";
import { useKpiNow, useZoneNow } from "@/hooks/useZoneNow";
import { t } from "@/lib/i18n";
import { useUi } from "@/lib/store";
import { CityMap } from "@/components/map/CityMap";
import { Legend } from "@/components/map/Legend";
import { AlertFeed } from "./AlertFeed";
import { KpiStrip } from "./KpiStrip";
import { RainPanel } from "./RainPanel";
import { TimeControls } from "./TimeControls";
import { ZoneCard } from "./ZoneCard";

/** Tab 1 — the money screen. Acts 1 (replay) and 2 (live) live here. */
export function CommandCenter() {
  const lang = useUi((s) => s.lang);
  const mode = useUi((s) => s.mode);
  const selected = useUi((s) => s.selectedZone);
  const setTick = useUi((s) => s.setTick);
  const setNTicks = useUi((s) => s.setNTicks);

  const { data: meta, error: metaError } = useMeta();
  const { data: zones } = useZones();
  const { data: timeline } = useTimeline();
  const { data: alerts } = useAlerts();
  const { data: assets } = useAssets();
  const { data: liveWeather } = useLiveWeather(mode === "live");
  const { data: liveState } = useLiveState(mode === "live");

  usePlayback();

  // Start parked shortly before the storm builds so the first "play" pays off within seconds.
  useEffect(() => {
    if (!timeline) return;
    setNTicks(timeline.meta.n_ticks);
    const per = 60 / timeline.meta.tick_minutes;
    setTick(Math.max(0, timeline.meta.peak_tick - 3 * per));
  }, [timeline, setNTicks, setTick]);

  const zoneNow = useZoneNow(timeline, liveState);
  const populations = useMemo(() => Object.fromEntries((zones?.features ?? []).map((z) => [z.properties.id, z.properties.population])), [zones]);
  const kpis = useKpiNow(timeline, zoneNow, populations);
  const redZones = useMemo(
    () =>
      (zones?.features ?? [])
        .filter((z) => (zoneNow[z.properties.id]?.risk ?? 0) >= 80)
        .map((z) => (lang === "ar" ? z.properties.name_ar : z.properties.name_en)),
    [zones, zoneNow, lang],
  );
  const selectedZone = zones?.features.find((z) => z.properties.id === selected);

  if (metaError) {
    return <Notice text={t(lang, "backend_down")} />;
  }
  if (meta && !meta.replay) {
    return <Notice text={t(lang, "not_seeded")} />;
  }

  return (
    <div className="grid h-full grid-cols-[320px_minmax(0,1fr)] gap-3 p-3">
      <AlertFeed alerts={alerts ?? []} zones={zones?.features ?? []} />

      <div className="flex min-h-0 flex-col gap-3">
        <KpiStrip kpis={kpis} fleetSize={assets?.length ?? 32} redZones={redZones} />

        <div className="relative min-h-0 flex-1 overflow-hidden rounded-[14px] ring-1 ring-line">
          {zones ? (
            <CityMap zones={zones.features} states={zoneNow} />
          ) : (
            <div className="backdrop absolute inset-0 grid place-items-center text-[13px] text-fg-2">
              <span className="flex items-center gap-3"><span className="h-2 w-2 animate-ping rounded-full bg-accent" />{t(lang, "map_loading")}</span>
            </div>
          )}

          {/* Overlays */}
          <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between p-3">
            <div className="flex items-start justify-between">
              <div className="pointer-events-auto"><Legend /></div>
              {selectedZone && (
                <div className="pointer-events-auto">
                  <ZoneCard zone={selectedZone} now={zoneNow[selectedZone.properties.id]} alerts={alerts ?? []} assets={assets ?? []} />
                </div>
              )}
            </div>
            <div className="flex flex-col gap-3">
              <div className="pointer-events-auto self-start"><RainPanel timeline={timeline} live={liveWeather} /></div>
              <div className="pointer-events-auto"><TimeControls timeline={timeline} live={liveWeather} /></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="glass flex max-w-md items-center gap-3 px-5 py-4 text-[13px] text-fg-2">
        <AlertOctagon size={18} className="shrink-0 text-orange" />
        <span>{text}</span>
      </div>
    </div>
  );
}
