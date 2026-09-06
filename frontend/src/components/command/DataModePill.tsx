"use client";

import clsx from "clsx";
import { t } from "@/lib/i18n";
import { useUi } from "@/lib/store";
import type { Meta } from "@/lib/api";

/** Honesty is a feature: the current data mode is always visible (CLAUDE.md §3). */
export function DataModePill({ meta }: { meta?: Meta }) {
  const lang = useUi((s) => s.lang);
  const mode = useUi((s) => s.mode);
  const live = mode === "live";
  const source =
    meta?.replay?.rain_source === "open-meteo-archive" ? t(lang, "source_open_meteo") : t(lang, "source_fallback");

  return (
    <div
      className={clsx("status-pill", live ? "text-green" : "text-yellow")}
      style={{ borderColor: live ? "rgba(34,197,94,0.35)" : "rgba(234,179,8,0.35)" }}
      title={live ? t(lang, "source_live") : `${t(lang, "pill_replay_sub")} · ${source}`}
    >
      <span className={clsx("dot", live ? "bg-green dot-pulse" : "bg-yellow")} />
      {live ? t(lang, "pill_live") : t(lang, "pill_simulated")}
      <span className="hidden font-medium tracking-normal text-fg-2 xl:inline">· {live ? t(lang, "source_live") : source}</span>
    </div>
  );
}
