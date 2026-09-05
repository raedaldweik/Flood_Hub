import type { Band } from "./api";

/** Risk bands — mirrors backend/sadd/sim/physics.py (≥40 yellow, ≥60 orange, ≥80 red). */
export const BANDS = { yellow: 40, orange: 60, red: 80 } as const;

export const BAND_COLORS: Record<Band, string> = {
  green: "#22c55e",
  yellow: "#eab308",
  orange: "#f97316",
  red: "#ef4444",
};

export function bandOf(risk: number): Band {
  if (risk >= BANDS.red) return "red";
  if (risk >= BANDS.orange) return "orange";
  if (risk >= BANDS.yellow) return "yellow";
  return "green";
}

/** Continuous green→yellow→orange→red ramp so polygons breathe instead of snapping. */
export function riskColor(risk: number): string {
  const stops: [number, [number, number, number]][] = [
    [0, [34, 197, 94]],
    [40, [234, 179, 8]],
    [60, [249, 115, 22]],
    [80, [239, 68, 68]],
    [100, [220, 38, 38]],
  ];
  const r = Math.max(0, Math.min(100, risk));
  for (let i = 1; i < stops.length; i++) {
    const [x1, c1] = stops[i - 1]!;
    const [x2, c2] = stops[i]!;
    if (r <= x2) {
      const t = (r - x1) / (x2 - x1);
      const mix = c1.map((v, k) => Math.round(v + (c2[k]! - v) * t));
      return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`;
    }
  }
  return "rgb(220, 38, 38)";
}

export function riskColorAlpha(risk: number, alpha: number): string {
  return riskColor(risk).replace("rgb(", "rgba(").replace(")", `, ${alpha})`);
}

/** Quantise so the map only re-paints when the colour actually moves. */
export function quantiseRisk(risk: number): number {
  return Math.round(risk / 2) * 2;
}
