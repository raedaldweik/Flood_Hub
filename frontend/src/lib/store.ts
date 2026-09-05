/**
 * Global UI state (zustand). Deliberately small: language, data mode, playback, selection.
 * Server data lives in SWR caches, not here.
 */

import { create } from "zustand";
import type { Lang } from "./i18n";

export type DataMode = "replay" | "live";
export type Speed = 1 | 5 | 20;

interface UiState {
  lang: Lang;
  setLang: (l: Lang) => void;

  mode: DataMode;
  setMode: (m: DataMode) => void;

  tick: number;
  nTicks: number;
  setTick: (t: number) => void;
  setNTicks: (n: number) => void;

  playing: boolean;
  speed: Speed;
  setPlaying: (p: boolean) => void;
  togglePlaying: () => void;
  setSpeed: (s: Speed) => void;

  selectedZone: string | null;
  selectZone: (id: string | null) => void;
  /** Incremented to ask the map to fly to the selected zone (click on alert / card button). */
  flyRequest: number;
  requestFly: (id: string) => void;
  resetRequest: number;
  requestReset: () => void;

  rafidOpen: boolean;
  setRafidOpen: (o: boolean) => void;
  rainOpen: boolean;
  setRainOpen: (o: boolean) => void;
}

export const useUi = create<UiState>((set) => ({
  lang: "en",
  setLang: (lang) => {
    set({ lang });
    try {
      localStorage.setItem("sadd.lang", lang);
    } catch {}
  },

  mode: "replay",
  setMode: (mode) => set({ mode, playing: false }),

  tick: 0,
  nTicks: 1,
  setTick: (tick) => set((s) => ({ tick: Math.max(0, Math.min(s.nTicks - 1, Math.round(tick))) })),
  setNTicks: (nTicks) => set({ nTicks }),

  playing: false,
  speed: 5,
  setPlaying: (playing) => set({ playing }),
  togglePlaying: () => set((s) => ({ playing: !s.playing })),
  setSpeed: (speed) => set({ speed }),

  selectedZone: null,
  selectZone: (selectedZone) => set({ selectedZone }),
  flyRequest: 0,
  requestFly: (id) => set((s) => ({ selectedZone: id, flyRequest: s.flyRequest + 1 })),
  resetRequest: 0,
  requestReset: () => set((s) => ({ selectedZone: null, resetRequest: s.resetRequest + 1 })),

  rafidOpen: true,
  setRafidOpen: (rafidOpen) => set({ rafidOpen }),
  rainOpen: true,
  setRainOpen: (rainOpen) => set({ rainOpen }),
}));

export function useT() {
  const lang = useUi((s) => s.lang);
  return lang;
}
