"use client";

import { useEffect } from "react";
import { useUi } from "@/lib/store";

/**
 * requestAnimationFrame playback. 1× advances one tick (10 storm-minutes) per second;
 * 20× plays the whole 72-hour replay in ~22 s. Fractional progress is accumulated so
 * playback speed is independent of frame rate.
 */
export function usePlayback() {
  const playing = useUi((s) => s.playing);
  const speed = useUi((s) => s.speed);
  const mode = useUi((s) => s.mode);

  useEffect(() => {
    if (!playing || mode !== "replay") return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      acc += dt * speed;
      if (acc >= 1) {
        const n = Math.floor(acc);
        acc -= n;
        const s = useUi.getState();
        const next = s.tick + n;
        if (next >= s.nTicks - 1) {
          s.setTick(s.nTicks - 1);
          s.setPlaying(false);
          return;
        }
        s.setTick(next);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, mode]);

  // Space toggles play/pause when focus is not in an input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.code === "Space" && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "BUTTON") {
        e.preventDefault();
        const s = useUi.getState();
        if (s.mode === "replay") s.togglePlaying();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
