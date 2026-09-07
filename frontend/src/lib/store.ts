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
  skylineRequest: number;
  requestSkyline: () => void;
  /** Risk-lit towers layer on the 3D map (OpenStreetMap footprints, lit by zone risk). */
  towers: boolean;
  setTowers: (on: boolean) => void;
  /** Pump-truck / tanker markers on the map (positions come from /api/assets; only rules move them). */
  fleet: boolean;
  setFleet: (on: boolean) => void;
  /** A tab asking Rafid something on the operator's behalf (e.g. "explain this plan"); the panel sends it. */
  rafidAsk: { n: number; text: string };
  askRafid: (text: string) => void;

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
  skylineRequest: 0,
  requestSkyline: () => set((s) => ({ selectedZone: null, skylineRequest: s.skylineRequest + 1 })),
  towers: true,
  setTowers: (towers) => set({ towers }),
  fleet: true,
  setFleet: (fleet) => set({ fleet }),
  rafidAsk: { n: 0, text: "" },
  askRafid: (text) => set((s) => ({ rafidAsk: { n: s.rafidAsk.n + 1, text }, rafidOpen: true })),

  rafidOpen: true,
  setRafidOpen: (rafidOpen) => set({ rafidOpen }),
  rainOpen: true,
  setRainOpen: (rainOpen) => set({ rainOpen }),
}));

export function useT() {
  const lang = useUi((s) => s.lang);
  return lang;
}
