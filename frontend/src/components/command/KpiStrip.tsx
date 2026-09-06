"use client";

import clsx from "clsx";
import { AlertTriangle, Clock, MapPinned, Truck, Users } from "lucide-react";
import type { KpiSeries } from "@/lib/api";
import type { KpiNow } from "@/hooks/useZoneNow";
import { fmtCompact, fmtDuration, fmtInt } from "@/lib/format";
import { t } from "@/lib/i18n";
import { useUi } from "@/lib/store";

interface Props {
  kpis: KpiNow;
  series?: KpiSeries;
  tick: number;
  fleetSize: number;
  redZones: string[];
}

type Tone = "neutral" | "red" | "orange" | "accent";
const TONE_HEX: Record<Tone, string> = { neutral: "#8d98ad", red: "#ef4444", orange: "#f97316", accent: "#22d3ee" };

/** Six hours of history as a tiny area chart — the strip breathes with the storm. */
function Sparkline({ values, tone }: { values: number[]; tone: Tone }) {
  const w = 84;
  const h = 26;
  if (values.length < 2) return <svg width={w} height={h} />;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 2 - (v / max) * (h - 6)] as const);
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  const c = TONE_HEX[tone];
  const id = `sp-${tone}`;
  return (
    <svg width={w} height={h} className="overflow-visible">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c} stopOpacity={0.45} />
          <stop offset="100%" stopColor={c} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={c} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1]![0]} cy={pts[pts.length - 1]![1]} r={2.2} fill={c} />
    </svg>
  );
}

export function KpiStrip({ kpis, series, tick, fleetSize, redZones }: Props) {
  const lang = useUi((s) => s.lang);
  const hot = kpis.zonesAtRisk > 0;
  const win = (arr?: (number | null)[]) => (arr ? arr.slice(Math.max(0, tick - 36), tick + 1).map((v) => v ?? 0) : []);

  const cards: { icon: typeof Clock; label: string; value: string; tone: Tone; sub: string | null; spark: number[] }[] = [
    {
      icon: AlertTriangle, label: t(lang, "kpi_alerts"), value: fmtInt(kpis.activeAlerts, lang),
      tone: kpis.activeAlerts > 0 ? "red" : "neutral", sub: null, spark: win(series?.active_alerts),
    },
    {
      icon: MapPinned, label: t(lang, "kpi_zones"), value: fmtInt(kpis.zonesAtRisk, lang),
      tone: hot ? "orange" : "neutral", sub: redZones.length ? redZones.join(" · ") : null, spark: win(series?.zones_at_risk),
    },
    {
      icon: Truck, label: t(lang, "kpi_assets"), value: fmtInt(kpis.assetsDeployed, lang),
      tone: "neutral", sub: `${t(lang, "kpi_of")} ${fmtInt(fleetSize, lang)}`, spark: win(series?.assets_deployed),
    },
    {
      icon: Users, label: t(lang, "kpi_population"), value: fmtCompact(kpis.populationAffected, lang),
      tone: kpis.populationAffected > 0 ? "orange" : "neutral", sub: null, spark: win(series?.population_affected),
    },
    {
      icon: Clock, label: t(lang, "kpi_lead"), value: fmtDuration(kpis.leadTimeMin, lang),
      tone: kpis.leadTimeMin != null ? "accent" : "neutral", sub: t(lang, "kpi_lead_hint"), spark: win(series?.lead_time_min),
    },
  ];

  return (
    <div className="grid grid-cols-5 gap-3">
      {cards.map((c) => {
        const hex = TONE_HEX[c.tone];
        return (
          <div key={c.label} className="glass relative overflow-hidden px-4 pb-3 pt-3.5">
            {c.tone !== "neutral" && (
              <div
                className="pointer-events-none absolute -end-6 -top-8 h-28 w-28 rounded-full"
                style={{ background: `radial-gradient(circle, ${hex}33 0%, transparent 65%)` }}
              />
            )}
            <div className="absolute inset-x-0 top-0 h-px" style={{ background: c.tone === "neutral" ? "rgba(255,255,255,0.10)" : `linear-gradient(90deg, ${hex}, ${hex}22)` }} />
            <div className="flex items-center gap-2">
              <span className="glass-inset grid h-6 w-6 place-items-center" style={{ color: hex }}>
                <c.icon size={13} />
              </span>
              <span className="label truncate whitespace-nowrap">{c.label}</span>
            </div>
            <div className="mt-2 flex items-end justify-between gap-2">
              <div className="min-w-0">
                <div className={clsx("display num text-[31px]", c.tone === "neutral" ? "text-fg" : "")} style={c.tone !== "neutral" ? { color: hex, textShadow: `0 0 22px ${hex}66` } : undefined}>
                  {c.value}
                </div>
                <div className="mt-1 h-4 truncate text-[11px] text-muted">{c.sub ?? " "}</div>
              </div>
              <div className="shrink-0 pb-4">
                <Sparkline values={c.spark} tone={c.tone} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
