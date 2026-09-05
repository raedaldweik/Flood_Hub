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
      className={clsx(
        "flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold tracking-wider",
        live ? "border-green/40 bg-green/10 text-green" : "border-yellow/40 bg-yellow/10 text-yellow",
      )}
      title={live ? t(lang, "source_live") : `${t(lang, "pill_replay_sub")} · ${source}`}
    >
      <span className={clsx("dot", live ? "bg-green dot-pulse" : "bg-yellow")} />
      {live ? t(lang, "pill_live") : t(lang, "pill_simulated")}
      <span className="hidden font-normal normal-case tracking-normal text-fg-2 xl:inline">
        · {live ? t(lang, "source_live") : source}
      </span>
    </div>
  );
}
