"use client";

import clsx from "clsx";
import { AlertTriangle, Clock, MapPinned, Truck, Users } from "lucide-react";
import type { KpiNow } from "@/hooks/useZoneNow";
import { fmtCompact, fmtDuration, fmtInt } from "@/lib/format";
import { t } from "@/lib/i18n";
import { useUi } from "@/lib/store";

interface Props {
  kpis: KpiNow;
  fleetSize: number;
  redZones: string[];
}

export function KpiStrip({ kpis, fleetSize, redZones }: Props) {
  const lang = useUi((s) => s.lang);
  const hot = kpis.zonesAtRisk > 0;

  const cards = [
    {
      icon: AlertTriangle,
      label: t(lang, "kpi_alerts"),
      value: fmtInt(kpis.activeAlerts, lang),
      tone: kpis.activeAlerts > 0 ? "red" : "neutral",
      sub: null,
    },
    {
      icon: MapPinned,
      label: t(lang, "kpi_zones"),
      value: fmtInt(kpis.zonesAtRisk, lang),
      tone: hot ? "orange" : "neutral",
      sub: redZones.length ? redZones.join(" · ") : null,
    },
    {
      icon: Truck,
      label: t(lang, "kpi_assets"),
      value: `${fmtInt(kpis.assetsDeployed, lang)}`,
      tone: "neutral",
      sub: `${t(lang, "kpi_of")} ${fmtInt(fleetSize, lang)}`,
    },
    {
      icon: Users,
      label: t(lang, "kpi_population"),
      value: fmtCompact(kpis.populationAffected, lang),
      tone: kpis.populationAffected > 0 ? "orange" : "neutral",
      sub: null,
    },
    {
      icon: Clock,
      label: t(lang, "kpi_lead"),
      value: fmtDuration(kpis.leadTimeMin, lang),
      tone: kpis.leadTimeMin != null ? "accent" : "neutral",
      sub: t(lang, "kpi_lead_hint"),
    },
  ] as const;

  return (
    <div className="grid grid-cols-5 gap-2">
      {cards.map((c) => (
        <div key={c.label} className="glass relative overflow-hidden px-4 py-3">
          <div
            className={clsx(
              "absolute inset-x-0 top-0 h-px",
              c.tone === "red" && "bg-red/70",
              c.tone === "orange" && "bg-orange/70",
              c.tone === "accent" && "bg-accent/70",
              c.tone === "neutral" && "bg-line-2",
            )}
          />
          <div className="flex items-center justify-between">
            <span className="label truncate whitespace-nowrap">{c.label}</span>
            <c.icon
              size={14}
              className={clsx(
                c.tone === "red" && "text-red",
                c.tone === "orange" && "text-orange",
                c.tone === "accent" && "text-accent",
                c.tone === "neutral" && "text-muted",
              )}
            />
          </div>
          <div
            className={clsx(
              "num mt-1 text-[30px] font-semibold leading-none",
              c.tone === "red" && "text-red",
              c.tone === "orange" && "text-orange",
            )}
          >
            {c.value}
          </div>
          <div className="mt-1.5 h-4 truncate text-[11px] text-muted">{c.sub ?? " "}</div>
        </div>
      ))}
    </div>
  );
}
