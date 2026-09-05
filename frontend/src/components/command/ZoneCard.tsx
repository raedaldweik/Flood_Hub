"use client";

import clsx from "clsx";
import { ArrowUpRight, Droplets, Info, Mountain, TrafficCone, Users, X } from "lucide-react";
import type { Alert, Asset, ZoneFeature } from "@/lib/api";
import { useExplain } from "@/hooks/useData";
import type { ZoneNow } from "@/hooks/useZoneNow";
import { fmtInt } from "@/lib/format";
import { bandLabel, driverLabel, t } from "@/lib/i18n";
import { BAND_COLORS, riskColor } from "@/lib/risk";
import { useUi } from "@/lib/store";

interface Props {
  zone: ZoneFeature;
  now: ZoneNow | undefined;
  alerts: Alert[];
  assets: Asset[];
}

export function ZoneCard({ zone, now, alerts, assets }: Props) {
  const lang = useUi((s) => s.lang);
  const mode = useUi((s) => s.mode);
  const tick = useUi((s) => s.tick);
  const selectZone = useUi((s) => s.selectZone);
  const requestFly = useUi((s) => s.requestFly);
  const p = zone.properties;
  const risk = now?.risk ?? 0;
  const band = now?.band ?? "green";
  const color = BAND_COLORS[band];

  const { data: explainData } = useExplain(p.id, tick, mode === "replay");
  const explain = mode === "replay" ? explainData : undefined;
  const contributions = (explain?.contributions ?? []).filter((c) => c.points > 0).sort((a, b) => b.points - a.points);

  const zoneAlerts =
    mode === "replay"
      ? alerts.filter((a) => a.zone_id === p.id && (a.tick ?? 0) <= tick && (a.cleared_tick == null || a.cleared_tick > tick))
      : [];
  const onSite = assets.filter((a) => a.zone_id === p.id);

  return (
    <aside className="glass glass-strong fade-in w-[340px] overflow-hidden">
      <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, ${color}, ${color}55)` }} />
      <header className="flex items-start gap-3 px-4 pt-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[16px] font-semibold leading-tight">{lang === "ar" ? p.name_ar : p.name_en}</h3>
          <div className="mt-0.5 truncate text-[11.5px] text-muted">
            <bdi>{lang === "ar" ? p.name_en : p.name_ar}</bdi> · <span className="num">{p.area_km2.toFixed(1)} km²</span>
          </div>
        </div>
        <button onClick={() => requestFly(p.id)} className="rounded-md p-1.5 text-fg-2 hover:bg-white/[0.06] hover:text-fg" title={t(lang, "zone_fly")}>
          <ArrowUpRight size={15} />
        </button>
        <button onClick={() => selectZone(null)} className="rounded-md p-1.5 text-fg-2 hover:bg-white/[0.06] hover:text-fg" title={t(lang, "zone_close")}>
          <X size={15} />
        </button>
      </header>

      <div className="flex items-end gap-4 px-4 pb-3 pt-2">
        <div>
          <div className="label">{t(lang, "zone_risk")}</div>
          <div className="num text-[44px] font-semibold leading-none" style={{ color: riskColor(risk) }}>
            {Math.round(risk)}
          </div>
        </div>
        <div className="mb-1 flex flex-col gap-1.5">
          <span className="w-fit rounded px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider" style={{ color, background: `${color}22`, border: `1px solid ${color}66` }}>
            {bandLabel(lang, band)}
          </span>
          {now?.flooded && (
            <span className="w-fit rounded bg-red/15 px-2 py-0.5 text-[10.5px] font-bold tracking-wider text-red ring-1 ring-red/40">
              {t(lang, "zone_flooded")}
            </span>
          )}
        </div>
        <div className="ms-auto grid grid-cols-2 gap-x-4 gap-y-1.5 text-end">
          <Stat label={t(lang, "zone_rain")} value={`${(now?.rain ?? 0).toFixed(1)}`} unit="mm/h" />
          <Stat label={t(lang, "zone_drainage")} value={`${p.drainage_capacity_mm_per_h.toFixed(0)}`} unit="mm/h" />
          <Stat label={t(lang, "zone_depth")} value={`${(now?.depth ?? 0).toFixed(0)}`} unit="cm" hint={t(lang, "zone_depth_hint")} />
          <Stat label={t(lang, "zone_impervious")} value={`${p.imperviousness_pct.toFixed(0)}`} unit="%" />
        </div>
      </div>

      {/* WHY */}
      <div className="border-t border-line px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="label">{t(lang, "zone_why")}</span>
          <span className="group relative">
            <Info size={12} className="text-muted" />
            <span className="pointer-events-none absolute end-0 top-5 z-20 hidden w-64 rounded-lg border border-line bg-panel-solid p-2.5 text-[11px] leading-snug text-fg-2 shadow-xl group-hover:block">
              {t(lang, "zone_physics_note")}
            </span>
          </span>
        </div>
        <ul className="mt-2 space-y-1.5">
          {contributions.length === 0 && (
            <li className="text-[12px] text-muted">{mode === "live" ? t(lang, "zone_why_live") : "—"}</li>
          )}
          {contributions.map((c) => (
            <li key={c.driver} className="flex items-center gap-2 text-[12px]">
              <span className="w-[130px] truncate text-fg-2">{driverLabel(lang, c.driver)}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                <span className="block h-full rounded-full" style={{ width: `${Math.min(100, (c.points / 30) * 100)}%`, background: color }} />
              </span>
              <span className="num w-8 text-end text-fg">{c.points.toFixed(0)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid grid-cols-3 gap-px border-t border-line bg-line">
        <Cell icon={Users} label={t(lang, "zone_population")} value={fmtInt(p.population, lang)} />
        <Cell icon={Droplets} label={t(lang, "zone_assets")} value={fmtInt(onSite.length, lang)} />
        <Cell icon={TrafficCone} label={t(lang, "zone_alerts")} value={fmtInt(zoneAlerts.length, lang)} tone={zoneAlerts.length ? "red" : undefined} />
      </div>
      <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-[11px] text-muted">
        <span className="flex items-center gap-1"><Mountain size={11} /> {t(lang, "zone_elevation")} {p.elevation_m} m</span>
        <span className={clsx(p.has_underpass ? "text-orange" : "")}>{t(lang, "zone_underpass")}: {p.has_underpass ? "✓" : "—"}</span>
        <span className="ms-auto">C{p.criticality}</span>
      </div>
    </aside>
  );
}

function Stat({ label, value, unit, hint }: { label: string; value: string; unit: string; hint?: string }) {
  return (
    <div title={hint}>
      <div className="text-[10px] leading-none text-muted">{label}</div>
      <div className="num text-[14px] font-semibold leading-tight text-fg">
        {value} <span className="text-[10px] font-normal text-muted">{unit}</span>
      </div>
    </div>
  );
}

function Cell({ icon: Icon, label, value, tone }: { icon: typeof Users; label: string; value: string; tone?: "red" }) {
  return (
    <div className="bg-panel-solid/80 px-3 py-2">
      <div className="flex items-center gap-1 text-[10px] text-muted"><Icon size={11} /> {label}</div>
      <div className={clsx("num text-[16px] font-semibold", tone === "red" && "text-red")}>{value}</div>
    </div>
  );
}
