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

function RingGauge({ value, color }: { value: number; color: string }) {
  const r = 38;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(100, value)) / 100);
  return (
    <svg width={96} height={96} viewBox="0 0 96 96" className="shrink-0">
      <circle cx={48} cy={48} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={7} />
      <circle
        cx={48} cy={48} r={r} fill="none" stroke={color} strokeWidth={7} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 48 48)"
        style={{ transition: "stroke-dashoffset 0.4s ease, stroke 0.4s ease", filter: `drop-shadow(0 0 6px ${color}99)` }}
      />
      <text x={48} y={54} textAnchor="middle" fontSize={28} fontWeight={800} fill={color} style={{ letterSpacing: "-0.03em" }}>
        {Math.round(value)}
      </text>
    </svg>
  );
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
    <aside className="glass glass-strong glass-hero animate-slide-up w-[352px] overflow-hidden">
      <div className="h-[3px] w-full" style={{ background: `linear-gradient(90deg, ${color}, ${color}33)` }} />
      <header className="flex items-start gap-3 px-4 pt-3.5">
        <div className="min-w-0 flex-1">
          <h3 className="display truncate text-[20px] text-fg">{lang === "ar" ? p.name_ar : p.name_en}</h3>
          <div className="mt-1 truncate text-[11.5px] font-semibold text-muted">
            <bdi>{lang === "ar" ? p.name_en : p.name_ar}</bdi> · <span className="num">{p.area_km2.toFixed(1)} km²</span>
            {p.has_underpass && <span className="ms-2 text-orange">{t(lang, "zone_underpass")} ✓</span>}
          </div>
        </div>
        <button onClick={() => requestFly(p.id)} className="btn-ghost px-2" title={t(lang, "zone_fly")}><ArrowUpRight size={14} /></button>
        <button onClick={() => selectZone(null)} className="btn-ghost px-2" title={t(lang, "zone_close")}><X size={14} /></button>
      </header>

      <div className="flex items-center gap-3 px-4 pb-3 pt-2">
        <div className="flex flex-col items-center gap-1.5">
          <RingGauge value={risk} color={riskColor(risk)} />
          <span className="rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.14em]" style={{ color, background: `${color}22`, border: `1px solid ${color}66` }}>
            {bandLabel(lang, band)}
          </span>
        </div>
        <div className="grid flex-1 grid-cols-2 gap-1.5">
          <Stat label={t(lang, "zone_rain")} value={(now?.rain ?? 0).toFixed(1)} unit="mm/h" />
          <Stat label={t(lang, "zone_drainage")} value={p.drainage_capacity_mm_per_h.toFixed(0)} unit="mm/h" />
          <Stat label={t(lang, "zone_depth")} value={(now?.depth ?? 0).toFixed(0)} unit="cm" hint={t(lang, "zone_depth_hint")} hot={now?.flooded} />
          <Stat label={t(lang, "zone_impervious")} value={p.imperviousness_pct.toFixed(0)} unit="%" />
        </div>
      </div>
      {now?.flooded && (
        <div className="mx-4 mb-2 flex items-center gap-2 rounded-lg bg-red/15 px-3 py-1.5 text-[10.5px] font-extrabold tracking-[0.16em] text-red ring-1 ring-red/40">
          <span className="dot dot-pulse bg-red" /> {t(lang, "zone_flooded")}
        </div>
      )}

      {/* WHY */}
      <div className="border-t border-line px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="panel-title">{t(lang, "zone_why")}</span>
          <span className="accent-line" />
          <span className="group relative">
            <Info size={12} className="text-muted" />
            <span className="pointer-events-none absolute end-0 top-5 z-20 hidden w-64 rounded-lg border border-line bg-panel-solid p-2.5 text-[11px] leading-snug text-fg-2 shadow-xl group-hover:block">
              {t(lang, "zone_physics_note")}
            </span>
          </span>
        </div>
        <ul className="mt-2.5 space-y-1.5">
          {contributions.length === 0 && (
            <li className="text-[12px] text-muted">{mode === "live" ? t(lang, "zone_why_live") : "—"}</li>
          )}
          {contributions.map((c) => (
            <li key={c.driver} className="flex items-center gap-2 text-[12px]">
              <span className="w-[132px] truncate font-semibold text-fg-2">{driverLabel(lang, c.driver)}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                <span className="block h-full rounded-full transition-all duration-300" style={{ width: `${Math.min(100, (c.points / 30) * 100)}%`, background: `linear-gradient(90deg, ${color}99, ${color})`, boxShadow: `0 0 8px ${color}66` }} />
              </span>
              <span className="num w-7 text-end font-bold text-fg">{c.points.toFixed(0)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid grid-cols-3 gap-px border-t border-line bg-line">
        <Cell icon={Users} label={t(lang, "zone_population")} value={fmtInt(p.population, lang)} />
        <Cell icon={Droplets} label={t(lang, "zone_assets")} value={fmtInt(onSite.length, lang)} />
        <Cell icon={TrafficCone} label={t(lang, "zone_alerts")} value={fmtInt(zoneAlerts.length, lang)} tone={zoneAlerts.length ? "red" : undefined} />
      </div>
      <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-[11px] font-semibold text-muted">
        <span className="flex items-center gap-1"><Mountain size={11} /> {t(lang, "zone_elevation")} {p.elevation_m} m</span>
        <span className="ms-auto trace-step-tool">C{p.criticality}</span>
      </div>
    </aside>
  );
}

function Stat({ label, value, unit, hint, hot }: { label: string; value: string; unit: string; hint?: string; hot?: boolean }) {
  return (
    <div className="glass-inset px-2.5 py-1.5" title={hint}>
      <div className="truncate text-[9.5px] font-bold uppercase tracking-wider text-muted">{label}</div>
      <div className={clsx("num text-[15px] font-extrabold leading-tight", hot ? "text-red" : "text-fg")}>
        {value} <span className="text-[10px] font-semibold text-muted">{unit}</span>
      </div>
    </div>
  );
}

function Cell({ icon: Icon, label, value, tone }: { icon: typeof Users; label: string; value: string; tone?: "red" }) {
  return (
    <div className="bg-panel-solid/70 px-3.5 py-2">
      <div className="flex items-center gap-1 text-[10px] font-semibold text-muted"><Icon size={11} /> {label}</div>
      <div className={clsx("num text-[17px] font-extrabold", tone === "red" && "text-red")}>{value}</div>
    </div>
  );
}
