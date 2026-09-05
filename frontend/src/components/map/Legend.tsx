"use client";

import { BAND_COLORS } from "@/lib/risk";
import { bandLabel, t } from "@/lib/i18n";
import { useUi } from "@/lib/store";

export function Legend() {
  const lang = useUi((s) => s.lang);
  const bands = ["green", "yellow", "orange", "red"] as const;
  return (
    <div className="glass flex items-center gap-3 px-3 py-1.5">
      <span className="label">{t(lang, "map_legend")}</span>
      {bands.map((b) => (
        <span key={b} className="flex items-center gap-1.5 text-[11px] text-fg-2">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: BAND_COLORS[b] }} />
          {bandLabel(lang, b)}
        </span>
      ))}
    </div>
  );
}
