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
    <section className="glass w-[410px] overflow-hidden">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 px-4 py-3 text-start">
        <span className="glass-inset grid h-6 w-6 place-items-center text-accent"><CloudRain size={13} /></span>
        <span className="panel-title whitespace-nowrap">{t(lang, "rain_title")}</span>
        <span className="num ms-1 whitespace-nowrap text-[15px] font-extrabold text-fg">
          {current.toFixed(1)} <span className="text-[10px] font-semibold text-muted">{t(lang, "rain_unit")}</span>
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
              <ComposedChart data={data} margin={{ top: 10, right: 14, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="rainFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.55} />
                    <stop offset="100%" stopColor="#22d3ee" stopOpacity={0.02} />
                  </linearGradient>
                  <filter id="rainGlow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="2.5" result="b" />
                    <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                </defs>
                <XAxis dataKey="ts" tickFormatter={(v: string) => fmtTime(v, lang)} tick={{ fill: "#7f8ba3", fontSize: 10, fontWeight: 600 }} axisLine={false} tickLine={false} minTickGap={40} />
                <YAxis domain={[0, maxY]} ticks={ticks} tick={{ fill: "#7f8ba3", fontSize: 10, fontWeight: 600 }} axisLine={false} tickLine={false} width={30} />
                <Tooltip
                  contentStyle={{ background: "rgba(14,21,40,0.95)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, fontSize: 11, boxShadow: "0 10px 30px rgba(0,0,0,.5)" }}
                  labelStyle={{ color: "#c3ccdb", fontWeight: 700 }}
                  labelFormatter={(v) => fmtTime(String(v), lang, true)}
                  formatter={(v) => [`${Number(v).toFixed(1)} ${t(lang, "rain_unit")}`, ""]}
                />
                <Area type="monotone" dataKey="past" stroke="#22d3ee" strokeWidth={2.2} fill="url(#rainFill)" isAnimationActive={false} connectNulls={false} filter="url(#rainGlow)" />
                <Line type="monotone" dataKey="future" stroke="#8d98ad" strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} connectNulls={false} />
                {nowTs && <ReferenceLine x={nowTs} stroke="#eef2f8" strokeOpacity={0.55} label={{ value: t(lang, "rain_now"), fill: "#c3ccdb", fontSize: 10, fontWeight: 700, position: "insideTopRight" }} />}
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
    </section>
  );
}
