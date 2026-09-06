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
  const active = visible.filter((a) => a.cleared_tick == null || a.cleared_tick > tick).length;
  const names = Object.fromEntries(zones.map((z) => [z.properties.id, lang === "ar" ? z.properties.name_ar : z.properties.name_en]));

  return (
    <section className="glass flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 px-4 pb-3 pt-4">
        <span className="panel-title">{t(lang, "alerts_title")}</span>
        <span className="accent-line" />
        <span className={clsx("dot", active ? "bg-red dot-pulse" : "bg-muted")} />
        <span className="num status-pill py-1 text-[11px]">{visible.length}</span>
      </header>

      <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3">
        {visible.length === 0 && (
          <li className="glass-inset mx-1 mt-1 px-4 py-6 text-center text-[12px] leading-relaxed text-muted">
            <BellRing size={18} className="mx-auto mb-2 text-accent/70" />
            {mode === "replay" ? t(lang, "alerts_empty_replay") : t(lang, "alerts_empty_live")}
          </li>
        )}
        {visible.map((a) => {
          const cleared = a.cleared_tick != null && a.cleared_tick <= tick;
          const color = BAND_COLORS[a.severity];
          const isUnderpass = a.type === "underpass_closure";
          return (
            <li key={a.id} className="animate-slide-up">
              <button
                onClick={() => requestFly(a.zone_id)}
                className={clsx(
                  "glass-inset group relative w-full overflow-hidden px-3.5 py-3 text-start transition-all hover:-translate-y-px hover:border-line-2 hover:bg-white/[0.06]",
                  selected === a.zone_id && "border-line-2 bg-white/[0.06]",
                  cleared && "opacity-45 saturate-50",
                )}
              >
                <span className="absolute inset-y-2.5 start-0 w-[3px] rounded-e-full" style={{ background: color, boxShadow: `0 0 10px ${color}` }} />
                <div className="flex items-center gap-2">
                  <span
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-px text-[9.5px] font-extrabold uppercase tracking-[0.12em]"
                    style={{ color, background: `${color}1f`, border: `1px solid ${color}55` }}
                  >
                    {isUnderpass && <TrafficCone size={10} />}
                    {a.severity}
                  </span>
                  <span className="truncate text-[13px] font-bold text-fg">{names[a.zone_id] ?? a.zone_id}</span>
                  <span className="num ms-auto text-[11px] font-semibold text-muted">{fmtTime(a.ts, lang)}</span>
                </div>
                <p className="mt-1.5 line-clamp-2 text-[12px] leading-snug text-fg-2">{lang === "ar" ? a.message_ar : a.message_en}</p>
                <div className="mt-2 flex items-center gap-2 text-[10.5px] text-muted">
                  <span className="trace-step-tool">{a.rule_id} v{a.rule_version}</span>
                  <span>{isUnderpass ? t(lang, "alerts_underpass") : t(lang, "alerts_zone_risk")}</span>
                  <span className={clsx("ms-auto font-bold uppercase tracking-wider", cleared ? "text-muted" : "text-green")}>
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
