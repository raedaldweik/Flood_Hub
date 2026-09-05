"use client";

import { useMemo } from "react";
import { ChevronDown, ChevronUp, CloudRain } from "lucide-react";
import { Area, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { LiveWeather, Timeline } from "@/lib/api";
import { fmtTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { useUi } from "@/lib/store";

interface Props {
  timeline?: Timeline;
  live?: LiveWeather;
}

interface Point {
  ts: string;
  past: number | null;
  future: number | null;
}

/** City rainfall: last 24 h solid, next 12 h dashed (forecast in live; "what came next" in replay). */
export function RainPanel({ timeline, live }: Props) {
  const lang = useUi((s) => s.lang);
  const mode = useUi((s) => s.mode);
  const tick = useUi((s) => s.tick);
  const open = useUi((s) => s.rainOpen);
  const setOpen = useUi((s) => s.setRainOpen);

  const { data, nowTs, current } = useMemo(() => {
    if (mode === "replay" && timeline) {
      const per = 60 / timeline.meta.tick_minutes;
      const from = Math.max(0, tick - 24 * per);
      const to = Math.min(timeline.ts.length - 1, tick + 12 * per);
      const pts: Point[] = [];
      for (let i = from; i <= to; i += Math.max(1, Math.floor(per / 2))) {
        const v = timeline.city_rain[i] ?? 0;
        pts.push({ ts: timeline.ts[i]!, past: i <= tick ? v : null, future: i >= tick ? v : null });
      }
      return { data: pts, nowTs: timeline.ts[tick]!, current: timeline.city_rain[tick] ?? 0 };
    }
    if (mode === "live" && live?.available) {
      const nowIso = (live.current?.time as string | undefined) ?? "";
      const pts: Point[] = live.hourly.map((h) => ({
        ts: h.ts,
        past: h.ts <= nowIso ? h.precipitation_mm : null,
        future: h.ts >= nowIso ? h.precipitation_mm : null,
      }));
      return { data: pts, nowTs: nowIso, current: Number(live.current?.precipitation ?? 0) };
    }
    return { data: [] as Point[], nowTs: "", current: 0 };
  }, [mode, tick, timeline, live]);

  const rawMax = Math.max(5, ...data.map((d) => Math.max(d.past ?? 0, d.future ?? 0)));
  const step = Math.max(1, Math.ceil((rawMax * 1.1) / 4));
  const ticks = [0, step, 2 * step, 3 * step, 4 * step];
  const maxY = 4 * step;

  return (
    <section className="glass w-[400px] overflow-hidden">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-4 py-2.5 text-start">
        <CloudRain size={14} className="text-accent" />
        <span className="whitespace-nowrap text-[13px] font-semibold">{t(lang, "rain_title")}</span>
        <span className="num ms-2 whitespace-nowrap text-[13px] text-fg-2">
          {current.toFixed(1)} <span className="text-[10px] text-muted">{t(lang, "rain_unit")}</span>
        </span>
        <span className="ms-auto truncate text-[10.5px] text-muted">
          {t(lang, "rain_past")} · {mode === "replay" ? t(lang, "rain_replay_future") : t(lang, "rain_forecast")}
        </span>
        {open ? <ChevronDown size={14} className="text-muted" /> : <ChevronUp size={14} className="text-muted" />}
      </button>
      {open && (
        <div className="h-[150px] px-2 pb-2" dir="ltr">
          {mode === "live" && !live?.available ? (
            <div className="grid h-full place-items-center px-6 text-center text-[12px] text-muted">{t(lang, "rain_live_unavailable")}</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="rainFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#22d3ee" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="ts"
                  tickFormatter={(v: string) => fmtTime(v, lang)}
                  tick={{ fill: "#7c8699", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={40}
                />
                <YAxis domain={[0, maxY]} ticks={ticks} tick={{ fill: "#7c8699", fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
                <Tooltip
                  contentStyle={{ background: "#0f1526", border: "1px solid rgba(148,163,184,.2)", borderRadius: 8, fontSize: 11 }}
                  labelStyle={{ color: "#aab3c5" }}
                  labelFormatter={(v) => fmtTime(String(v), lang, true)}
                  formatter={(v) => [`${Number(v).toFixed(1)} ${t(lang, "rain_unit")}`, ""]}
                />
                <Area type="monotone" dataKey="past" stroke="#22d3ee" strokeWidth={2} fill="url(#rainFill)" isAnimationActive={false} connectNulls={false} />
                <Line type="monotone" dataKey="future" stroke="#7c8699" strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} connectNulls={false} />
                {nowTs && <ReferenceLine x={nowTs} stroke="#e6eaf2" strokeOpacity={0.5} label={{ value: t(lang, "rain_now"), fill: "#aab3c5", fontSize: 10, position: "insideTopRight" }} />}
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
    </section>
  );
}
