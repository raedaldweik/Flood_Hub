"use client";

import { useMemo } from "react";
import type { Band, LiveState, Timeline } from "@/lib/api";
import { bandOf } from "@/lib/risk";
import { useUi } from "@/lib/store";

/** The per-zone snapshot every widget renders from, regardless of data mode. */
export interface ZoneNow {
  risk: number;
  band: Band;
  rain: number;
  cum3h: number;
  exceedance: number;
  depth: number;
  flooded: boolean;
}

export interface KpiNow {
  activeAlerts: number;
  zonesAtRisk: number;
  zonesFlooded: number;
  assetsDeployed: number;
  populationAffected: number;
  leadTimeMin: number | null;
}

export function useZoneNow(timeline: Timeline | undefined, live: LiveState | undefined) {
  const mode = useUi((s) => s.mode);
  const tick = useUi((s) => s.tick);

  return useMemo<Record<string, ZoneNow>>(() => {
    const out: Record<string, ZoneNow> = {};
    if (mode === "replay" && timeline) {
      for (const [id, z] of Object.entries(timeline.zones)) {
        const risk = z.risk[tick] ?? 0;
        out[id] = {
          risk,
          band: bandOf(risk),
          rain: z.rain[tick] ?? 0,
          cum3h: z.cum_3h[tick] ?? 0,
          exceedance: z.exceedance[tick] ?? 0,
          depth: z.depth_cm[tick] ?? 0,
          flooded: z.flooded[tick] ?? false,
        };
      }
    } else if (mode === "live" && live?.available) {
      for (const z of live.zones) {
        out[z.zone_id] = {
          risk: z.risk,
          band: z.band,
          rain: z.rain_mm_h,
          cum3h: z.cum_3h_mm,
          exceedance: z.exceedance_mm_h,
          depth: z.depth_cm,
          flooded: z.flooded,
        };
      }
    }
    return out;
  }, [mode, tick, timeline, live]);
}

export function useKpiNow(
  timeline: Timeline | undefined,
  zoneNow: Record<string, ZoneNow>,
  populations: Record<string, number>,
): KpiNow {
  const mode = useUi((s) => s.mode);
  const tick = useUi((s) => s.tick);
  return useMemo(() => {
    if (mode === "replay" && timeline) {
      const k = timeline.kpis;
      return {
        activeAlerts: k.active_alerts[tick] ?? 0,
        zonesAtRisk: k.zones_at_risk[tick] ?? 0,
        zonesFlooded: k.zones_flooded[tick] ?? 0,
        assetsDeployed: k.assets_deployed[tick] ?? 0,
        populationAffected: k.population_affected[tick] ?? 0,
        leadTimeMin: k.lead_time_min[tick] ?? null,
      };
    }
    const atRisk = Object.entries(zoneNow).filter(([, z]) => z.risk >= 60);
    return {
      activeAlerts: 0,
      zonesAtRisk: atRisk.length,
      zonesFlooded: Object.values(zoneNow).filter((z) => z.flooded).length,
      assetsDeployed: 0,
      populationAffected: atRisk.reduce((s, [id]) => s + (populations[id] ?? 0), 0),
      leadTimeMin: null,
    };
  }, [mode, tick, timeline, zoneNow, populations]);
}
