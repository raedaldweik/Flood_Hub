"use client";

import { useMemo } from "react";
import clsx from "clsx";
import { Building2, Gauge, Pause, Play, Radio, RotateCcw, SkipBack } from "lucide-react";
import type { Alert, LiveWeather, Timeline } from "@/lib/api";
import { fmtDate, fmtTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { BAND_COLORS } from "@/lib/risk";
import { useUi, type Speed } from "@/lib/store";

interface Props {
  timeline?: Timeline;
  live?: LiveWeather;
  alerts: Alert[];
}

const SPEEDS: Speed[] = [1, 5, 20];

/** The scrubber IS the storm: a rain histogram track with rule-fired alert ticks and the peak marker. */
export function TimeControls({ timeline, live, alerts }: Props) {
  const lang = useUi((s) => s.lang);
  const mode = useUi((s) => s.mode);
  const setMode = useUi((s) => s.setMode);
  const tick = useUi((s) => s.tick);
  const setTick = useUi((s) => s.setTick);
  const playing = useUi((s) => s.playing);
  const togglePlaying = useUi((s) => s.togglePlaying);
  const speed = useUi((s) => s.speed);
  const setSpeed = useUi((s) => s.setSpeed);
  const requestReset = useUi((s) => s.requestReset);
  const requestSkyline = useUi((s) => s.requestSkyline);

  const n = timeline?.meta.n_ticks ?? 1;
  const den = Math.max(1, n - 1);
  const pct = (tick / den) * 100;
  const peakPct = timeline ? (timeline.meta.peak_tick / den) * 100 : 0;
  const ts = timeline?.ts[tick];

  // Histogram bars: one per two ticks, normalised to the storm peak.
  const bars = useMemo(() => {
    if (!timeline) return [] as { x: number; h: number; i: number }[];
    const max = Math.max(1, ...timeline.city_rain);
    const out: { x: number; h: number; i: number }[] = [];
    for (let i = 0; i < n; i += 2) {
      const v = Math.max(timeline.city_rain[i] ?? 0, timeline.city_rain[i + 1] ?? 0);
      out.push({ x: (i / den) * 100, h: v / max, i });
    }
    return out;
  }, [timeline, n, den]);
  const events = useMemo(
    () => (n > 1 ? alerts.filter((a) => a.type === "zone_risk" && a.tick != null).map((a) => ({ x: ((a.tick ?? 0) / den) * 100, c: BAND_COLORS[a.severity] })) : []),
    [alerts, n, den],
  );
  const rtl = lang === "ar";
  const px = (x: number) => (rtl ? 100 - x : x);

  return (
    <div className="glass glass-strong glass-hero flex flex-col gap-2.5 px-4 py-3">
      {/* Row 1 — mode, act, clock */}
      <div className="flex items-center gap-3">
        <div className="seg">
          {(["replay", "live"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={clsx("flex items-center gap-1.5", mode === m && "on")}>
              {m === "live" ? <Radio size={13} className={mode === "live" ? "text-green" : ""} /> : <Gauge size={13} className={mode === "replay" ? "text-yellow" : ""} />}
              {m === "replay" ? t(lang, "mode_replay") : t(lang, "mode_live")}
            </button>
          ))}
        </div>
        <span className="status-pill py-1 text-[10px] text-accent">{mode === "replay" ? t(lang, "act_replay") : t(lang, "act_live")}</span>
        <span className="accent-line" />
        {mode === "replay" ? (
          <div className="num flex items-baseline gap-3 text-end">
            <span className="text-[11px] font-semibold text-muted">{ts ? fmtDate(ts, lang) : ""}</span>
            <span className="display text-[24px] text-fg">
              {ts ? fmtTime(ts, lang) : "--:--"} <span className="text-[10px] font-bold tracking-widest text-muted">AST</span>
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="dot dot-pulse bg-green" />
            <span className="text-[14px] font-extrabold">{t(lang, "time_today")} · {fmtDate(new Date(), lang)}</span>
          </div>
        )}
        <button onClick={requestSkyline} className="btn-ghost" title={t(lang, "time_skyline")} aria-label={t(lang, "time_skyline")}>
          <Building2 size={13} />
        </button>
        <button onClick={requestReset} className="btn-ghost" title={t(lang, "time_reset")}>
          <RotateCcw size={13} />
          <span className="hidden 2xl:inline">{t(lang, "time_reset")}</span>
        </button>
      </div>

      {/* Row 2 — transport + storm timeline */}
      {mode === "replay" ? (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <button onClick={() => setTick(0)} className="btn-ghost px-2" aria-label="Back to start">
              <SkipBack size={14} />
            </button>
            <button
              onClick={togglePlaying}
              className="glow-cyan grid h-10 w-10 place-items-center rounded-full text-[#06121a] transition hover:brightness-110 active:scale-95"
              style={{ background: "var(--cyan-grad)" }}
              aria-label={playing ? t(lang, "time_pause") : t(lang, "time_play")}
            >
              {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" className="ms-0.5" />}
            </button>
          </div>
          <div className="seg">
            {SPEEDS.map((s) => (
              <button key={s} onClick={() => setSpeed(s)} className={clsx("num !px-2.5", speed === s && "on")} title={`${s}× = ${s * (timeline?.meta.tick_minutes ?? 10)} min/s`}>
                {s}×
              </button>
            ))}
          </div>

          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center justify-between text-[10px] font-semibold text-muted">
              <span className="label">{t(lang, "time_timeline")}</span>
              <span className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-red" /> {t(lang, "time_events")}</span>
                <span className="text-red/80">▼ {t(lang, "time_peak")}</span>
                {timeline && <span>{fmtTime(timeline.meta.start_ts, lang, true)} → {fmtTime(timeline.meta.end_ts, lang, true)}</span>}
              </span>
            </div>
            <div className="relative h-11 overflow-visible rounded-lg bg-black/30 ring-1 ring-line" dir="ltr">
              <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 44">
                {bars.map((b) => {
                  const played = (rtl ? n - 1 - b.i : b.i) <= tick;
                  return (
                    <rect key={b.i} x={px(b.x) - 0.2} y={40 - b.h * 34} width={0.42} height={Math.max(0.6, b.h * 34)} fill={played ? "#22d3ee" : "#3b4a66"} opacity={played ? 0.95 : 0.55} />
                  );
                })}
                {events.map((e, i) => (
                  <rect key={i} x={px(e.x) - 0.15} y={40.5} width={0.3} height={3.5} fill={e.c} />
                ))}
                <text x={px(peakPct)} y={4} fontSize="3.2" fontWeight="800" textAnchor="middle" fill="#ef4444">▼</text>
                <rect x={px(pct) - 0.12} y={0} width={0.24} height={44} fill="#ffffff" opacity={0.9} />
              </svg>
              <div className="pointer-events-none absolute top-0 h-full w-px" style={{ left: `${px(pct)}%`, boxShadow: "0 0 10px 2px rgba(255,255,255,0.45)" }} />
              <input
                type="range"
                min={0}
                max={n - 1}
                value={tick}
                onChange={(e) => setTick(Number(e.target.value))}
                className="scrubber absolute inset-0"
                style={{ direction: rtl ? "rtl" : "ltr" }}
                aria-label="Replay position"
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="text-[11px] font-semibold text-muted">
          {t(lang, "time_live_source")}
          {live?.fetched_at ? ` · ${t(lang, "time_fetched")} ${fmtTime(live.fetched_at, lang)}` : ""}
          {live && !live.available ? ` · ${t(lang, "rain_live_unavailable")}` : ""}
        </div>
      )}
    </div>
  );
}
