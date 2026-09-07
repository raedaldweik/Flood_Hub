/**
 * Fleet markers shared by every map engine: one DOM pin per unit (pump truck / tanker), coloured by
 * status, plus a tween so a unit that the rules engine re-tasks glides to its new spot instead of
 * teleporting. Positions come from /api/assets — only rules/dispatch.py ever changes them.
 */

import type { Asset } from "@/lib/api";
import type { Lang } from "@/lib/i18n";

export type FleetStatus = Asset["status"];

export const FLEET_COLORS: Record<FleetStatus, string> = {
  idle: "#8d98ad",
  staged: "#22d3ee",
  enroute: "#eab308",
  pumping: "#22c55e",
};

// lucide "truck" and "droplet" outlines (ISC licence), inlined so the pins need no font or sprite.
const TRUCK = "M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2M15 18H9M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14";
const WHEELS = "M7 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0M15 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0";
const DROP = "M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z";

export function createFleetPin(): HTMLElement {
  const el = document.createElement("div");
  el.className = "fleet-pin";
  el.innerHTML =
    `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">` +
    `<path class="p-truck" d="${TRUCK}"/><path class="p-truck" d="${WHEELS}"/><path class="p-drop" d="${DROP}"/></svg>` +
    `<span class="fleet-tag"></span>`;
  return el;
}

export function paintFleetPin(el: HTMLElement, a: Asset, lang: Lang): void {
  const color = FLEET_COLORS[a.status] ?? FLEET_COLORS.idle;
  el.style.setProperty("--pin", color);
  el.dataset.status = a.status;
  el.dataset.type = a.type;
  const tag = el.querySelector(".fleet-tag") as HTMLElement | null;
  const callsign = lang === "ar" ? a.callsign_ar : a.callsign;
  if (tag) tag.textContent = callsign;
  el.title = `${callsign} · ${a.type === "pump_truck" ? "pump truck" : a.type} · ${a.capacity_m3_h} m³/h · ${a.status}${a.zone_id ? " · " + a.zone_id.replace(/_/g, " ") : ""}`;
}

export interface LatLng {
  lat: number;
  lng: number;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Per-unit position tween. `set()` with animate=true glides from the current spot; `tick()` advances. */
export class FleetTween {
  private cur = new Map<string, LatLng>();
  private anim = new Map<string, { from: LatLng; to: LatLng; t0: number; ms: number }>();

  set(id: string, to: LatLng, animate: boolean, ms = 1800): void {
    const from = this.cur.get(id);
    if (!animate || !from || (Math.abs(from.lat - to.lat) < 1e-7 && Math.abs(from.lng - to.lng) < 1e-7)) {
      this.cur.set(id, to);
      this.anim.delete(id);
      return;
    }
    this.anim.set(id, { from, to, t0: performance.now(), ms });
  }

  remove(id: string): void {
    this.cur.delete(id);
    this.anim.delete(id);
  }

  get(id: string): LatLng | undefined {
    return this.cur.get(id);
  }

  get animating(): boolean {
    return this.anim.size > 0;
  }

  /** Advance every active tween; returns the ids whose position changed this frame. */
  tick(now: number): string[] {
    const moved: string[] = [];
    for (const [id, a] of this.anim) {
      const t = ease(Math.min(1, (now - a.t0) / a.ms));
      this.cur.set(id, { lat: a.from.lat + (a.to.lat - a.from.lat) * t, lng: a.from.lng + (a.to.lng - a.from.lng) * t });
      moved.push(id);
      if (t >= 1) this.anim.delete(id);
    }
    return moved;
  }
}
