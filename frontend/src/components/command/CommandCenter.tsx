"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertOctagon, Waves } from "lucide-react";
import { useAlerts, useAssets, useLiveState, useLiveWeather, useMeta, useTimeline, useZones } from "@/hooks/useData";
import { usePlayback } from "@/hooks/usePlayback";
import { useKpiNow, useZoneNow } from "@/hooks/useZoneNow";
import type { StartupState } from "@/lib/api";
import { t, type Lang, type TKey } from "@/lib/i18n";
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
  const tick = useUi((s) => s.tick);
  const selected = useUi((s) => s.selectedZone);
  const setTick = useUi((s) => s.setTick);
  const setNTicks = useUi((s) => s.setNTicks);

  const { data: meta, error: metaError } = useMeta();
  // Data hooks stay idle until the backend reports `ready` (a first boot waits for Postgres + seed).
  const backendReady = meta?.startup?.phase === "ready";
  const { data: zones } = useZones(backendReady);
  const { data: timeline } = useTimeline(backendReady);
  const { data: alerts } = useAlerts(backendReady);
  const { data: assets } = useAssets(backendReady);
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

  // Boot overlay: keep the cinematic loader up until data is in, then let it fade.
  const ready = Boolean(zones && timeline && alerts);
  const [booted, setBooted] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const id = setTimeout(() => setBooted(true), 650);
    return () => clearTimeout(id);
  }, [ready]);

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

  if (metaError) return <Notice text={t(lang, "backend_down")} />;
  if (meta && !backendReady) return <StartupScreen startup={meta.startup} lang={lang} />;
  if (meta && !meta.replay) return <Notice text={t(lang, "not_seeded")} />;

  return (
    <div className="relative grid h-full grid-cols-[330px_minmax(0,1fr)] gap-3">
      <AlertFeed alerts={alerts ?? []} zones={zones?.features ?? []} />

      <div className="flex min-h-0 flex-col gap-3">
        <KpiStrip kpis={kpis} series={mode === "replay" ? timeline?.kpis : undefined} tick={tick} fleetSize={assets?.length ?? 32} redZones={redZones} />

        <div className="glass-hero relative min-h-0 flex-1 overflow-hidden rounded-[18px] ring-1 ring-line">
          {zones ? <CityMap zones={zones.features} states={zoneNow} /> : <div className="backdrop absolute inset-0" />}

          <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between p-3.5">
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
              <div className="pointer-events-auto"><TimeControls timeline={timeline} live={liveWeather} alerts={alerts ?? []} /></div>
            </div>
          </div>
        </div>
      </div>

      {!booted && (
        <div className={`absolute inset-0 z-40 grid place-items-center rounded-[18px] transition-opacity duration-500 ${ready ? "opacity-0" : "opacity-100"}`} style={{ background: "rgba(7,11,21,0.82)", backdropFilter: "blur(10px)" }}>
          <div className="flex flex-col items-center gap-5">
            <span className="avatar-ring grid h-16 w-16 place-items-center text-[#06121a]"><Waves size={30} strokeWidth={2.4} /></span>
            <div className="text-center">
              <div className="display text-[26px] text-fg">{t(lang, "boot_title")}</div>
              <div className="mt-2 text-[12.5px] font-semibold text-muted">{t(lang, "boot_sub")}</div>
            </div>
            <div className="h-1 w-64 overflow-hidden rounded-full bg-white/[0.08]">
              <div className="h-full rounded-full" style={{ background: "var(--cyan-grad)", animation: "boot-bar 1.6s ease-out forwards" }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** First boot on a fresh database: the backend is up but still waiting for Postgres or seeding. */
function StartupScreen({ startup, lang }: { startup: StartupState; lang: Lang }) {
  const failed = startup.phase === "seed_failed";
  const sub = t(lang, `startup_${startup.phase}` as TKey).replace("{n}", String(startup.attempts));
  return (
    <div className="grid h-full place-items-center rounded-[18px]" style={{ background: "rgba(7,11,21,0.82)", backdropFilter: "blur(10px)" }}>
      <div className="flex max-w-lg flex-col items-center gap-5 text-center">
        <span className={`avatar-ring grid h-16 w-16 place-items-center text-[#06121a] ${failed ? "" : "animate-pulse"}`}>
          {failed ? <AlertOctagon size={30} strokeWidth={2.4} /> : <Waves size={30} strokeWidth={2.4} />}
        </span>
        <div>
          <div className="display text-[26px] text-fg">{t(lang, failed ? "startup_failed_title" : "startup_title")}</div>
          <div className="mt-2 text-[12.5px] font-semibold leading-relaxed text-muted">{sub}</div>
          {failed && startup.detail && (
            <div className="mt-3 rounded-lg bg-white/[0.06] px-3 py-2 font-mono text-[11px] text-fg-2" dir="ltr">{startup.detail}</div>
          )}
        </div>
        {!failed && (
          <div className="h-1 w-64 overflow-hidden rounded-full bg-white/[0.08]">
            <div className="h-full w-1/3 rounded-full" style={{ background: "var(--cyan-grad)", animation: "boot-scan 1.8s ease-in-out infinite" }} />
          </div>
        )}
        <div className="text-[11px] tracking-wide text-muted/80">{t(lang, "startup_elapsed").replace("{s}", String(Math.round(startup.seconds)))}</div>
      </div>
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="glass flex max-w-md items-center gap-3 px-5 py-4 text-[13px] font-semibold text-fg-2">
        <AlertOctagon size={18} className="shrink-0 text-orange" />
        <span>{text}</span>
      </div>
    </div>
  );
}
