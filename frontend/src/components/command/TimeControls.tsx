"use client";

import clsx from "clsx";
import { Gauge, Pause, Play, Radio, RotateCcw, SkipBack } from "lucide-react";
import type { LiveWeather, Timeline } from "@/lib/api";
import { fmtDate, fmtTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { useUi, type Speed } from "@/lib/store";

interface Props {
  timeline?: Timeline;
  live?: LiveWeather;
}

const SPEEDS: Speed[] = [1, 5, 20];

export function TimeControls({ timeline, live }: Props) {
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

  const n = timeline?.meta.n_ticks ?? 1;
  const pct = n > 1 ? (tick / (n - 1)) * 100 : 0;
  const peakPct = timeline ? (timeline.meta.peak_tick / (n - 1)) * 100 : 0;
  const ts = timeline?.ts[tick];

  return (
    <div className="glass glass-strong flex items-center gap-4 px-4 py-2.5">
      {/* Mode toggle */}
      <div className="flex rounded-lg bg-white/[0.05] p-0.5 ring-1 ring-line">
        {(["replay", "live"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={clsx(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition",
              mode === m ? "bg-white/[0.1] text-fg shadow" : "text-fg-2 hover:text-fg",
            )}
          >
            {m === "live" ? <Radio size={13} className={mode === "live" ? "text-green" : ""} /> : <Gauge size={13} className={mode === "replay" ? "text-yellow" : ""} />}
            {m === "replay" ? t(lang, "mode_replay") : t(lang, "mode_live")}
          </button>
        ))}
      </div>

      {mode === "replay" ? (
        <>
          <div className="flex items-center gap-1">
            <button onClick={() => setTick(0)} className="rounded-md p-1.5 text-fg-2 hover:bg-white/[0.06] hover:text-fg" aria-label="Back to start">
              <SkipBack size={15} />
            </button>
            <button
              onClick={togglePlaying}
              className="grid h-9 w-9 place-items-center rounded-full bg-accent text-bg shadow-[0_0_0_4px_rgba(34,211,238,0.18)] transition hover:brightness-110"
              aria-label={playing ? t(lang, "time_pause") : t(lang, "time_play")}
            >
              {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ms-0.5" />}
            </button>
          </div>

          <div className="flex rounded-md bg-white/[0.05] p-0.5 ring-1 ring-line">
            {SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={clsx("num rounded px-2 py-1 text-[11.5px] font-medium", speed === s ? "bg-white/[0.1] text-fg" : "text-muted hover:text-fg")}
                title={`${s}× = ${s * (timeline?.meta.tick_minutes ?? 10)} min/s`}
              >
                {s}×
              </button>
            ))}
          </div>

          <div className="relative flex-1 px-1">
            <input
              type="range"
              min={0}
              max={n - 1}
              value={tick}
              onChange={(e) => setTick(Number(e.target.value))}
              className="scrubber"
              style={{ ["--pct" as string]: `${pct}%` }}
              aria-label="Replay position"
            />
            {timeline && (
              <span
                className="pointer-events-none absolute -top-2 -translate-x-1/2 text-[9px] uppercase tracking-wider text-red/80"
                style={{ [lang === "ar" ? "right" : "left"]: `calc(${peakPct}% + 4px)` }}
              >
                ▼ {t(lang, "time_peak")}
              </span>
            )}
            {timeline && (
              <div className="mt-1 flex justify-between text-[10px] text-muted">
                <span>{fmtTime(timeline.meta.start_ts, lang, true)}</span>
                <span>{fmtTime(timeline.meta.end_ts, lang, true)}</span>
              </div>
            )}
          </div>

          <div className="num min-w-[190px] text-end">
            <div className="text-[16px] font-semibold leading-tight text-fg">{ts ? fmtTime(ts, lang) : "--:--"} <span className="text-[10px] font-normal text-muted">AST</span></div>
            <div className="text-[11px] text-muted">{ts ? fmtDate(ts, lang) : ""}</div>
          </div>
        </>
      ) : (
        <div className="flex flex-1 items-center gap-4">
          <span className="dot dot-pulse bg-green" />
          <div>
            <div className="text-[14px] font-semibold">{t(lang, "time_today")} · {fmtDate(new Date(), lang)}</div>
            <div className="text-[11px] text-muted">
              {t(lang, "time_live_source")}
              {live?.fetched_at ? ` · ${t(lang, "time_fetched")} ${fmtTime(live.fetched_at, lang)}` : ""}
              {live && !live.available ? ` · ${t(lang, "rain_live_unavailable")}` : ""}
            </div>
          </div>
        </div>
      )}

      <button onClick={requestReset} className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-[11.5px] text-fg-2 hover:border-line-2 hover:text-fg" title={t(lang, "time_reset")}>
        <RotateCcw size={13} />
        <span className="hidden 2xl:inline">{t(lang, "time_reset")}</span>
      </button>
    </div>
  );
}
