"use client";

import clsx from "clsx";
import { BellRing, TrafficCone } from "lucide-react";
import type { Alert, ZoneFeature } from "@/lib/api";
import { fmtTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { BAND_COLORS } from "@/lib/risk";
import { useUi } from "@/lib/store";

interface Props {
  alerts: Alert[];
  zones: ZoneFeature[];
}

export function AlertFeed({ alerts, zones }: Props) {
  const lang = useUi((s) => s.lang);
  const mode = useUi((s) => s.mode);
  const tick = useUi((s) => s.tick);
  const requestFly = useUi((s) => s.requestFly);
  const selected = useUi((s) => s.selectedZone);

  // In replay only alerts raised at or before the current tick exist yet.
  const visible = mode === "replay" ? alerts.filter((a) => (a.tick ?? 0) <= tick) : [];
  const names = Object.fromEntries(zones.map((z) => [z.properties.id, lang === "ar" ? z.properties.name_ar : z.properties.name_en]));

  return (
    <section className="glass flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold">
          <BellRing size={14} className="text-accent" />
          {t(lang, "alerts_title")}
        </h2>
        <span className="num rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-fg-2">{visible.length}</span>
      </header>

      <ol className="min-h-0 flex-1 overflow-y-auto p-2">
        {visible.length === 0 && (
          <li className="px-3 py-8 text-center text-[12px] leading-relaxed text-muted">
            {mode === "replay" ? t(lang, "alerts_empty_replay") : t(lang, "alerts_empty_live")}
          </li>
        )}
        {visible.map((a) => {
          const cleared = a.cleared_tick != null && a.cleared_tick <= tick;
          const color = BAND_COLORS[a.severity];
          const isUnderpass = a.type === "underpass_closure";
          return (
            <li key={a.id} className="fade-in">
              <button
                onClick={() => requestFly(a.zone_id)}
                className={clsx(
                  "group relative w-full rounded-lg px-3 py-2.5 text-start transition hover:bg-white/[0.04]",
                  selected === a.zone_id && "bg-white/[0.05]",
                  cleared && "opacity-50",
                )}
              >
                <span className="absolute inset-y-2 start-0 w-[3px] rounded-full" style={{ background: color }} />
                <div className="flex items-center gap-2">
                  <span
                    className="rounded px-1.5 py-px text-[10px] font-bold uppercase tracking-wider"
                    style={{ color, background: `${color}22`, border: `1px solid ${color}55` }}
                  >
                    {isUnderpass ? <TrafficCone size={11} className="inline -mt-px" /> : null} {a.severity}
                  </span>
                  <span className="truncate text-[12.5px] font-medium text-fg">{names[a.zone_id] ?? a.zone_id}</span>
                  <span className="num ms-auto text-[11px] text-muted">{fmtTime(a.ts, lang)}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-fg-2">
                  {lang === "ar" ? a.message_ar : a.message_en}
                </p>
                <div className="mt-1.5 flex items-center gap-2 text-[10.5px] text-muted">
                  <span className="rounded border border-line px-1.5 py-px font-mono">
                    {a.rule_id} v{a.rule_version}
                  </span>
                  <span>{isUnderpass ? t(lang, "alerts_underpass") : t(lang, "alerts_zone_risk")}</span>
                  <span className={clsx("ms-auto", cleared ? "text-muted" : "text-green")}>
                    {cleared ? t(lang, "alerts_cleared") : t(lang, "alerts_active")}
                  </span>
                </div>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
