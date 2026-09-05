/**
 * Typed client for the FastAPI backend. Hand-mirrors backend/sadd/api/schemas.py —
 * keep the two in sync (a generated OpenAPI client is a Phase-4 nicety, not a need).
 */

/** Empty string = same origin (the production image, where FastAPI serves the static export). */
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

export type Severity = "yellow" | "orange" | "red";
export type Band = "green" | Severity;

export interface ZoneProperties {
  id: string;
  name_en: string;
  name_ar: string;
  area_km2: number;
  elevation_m: number;
  imperviousness_pct: number;
  drainage_capacity_mm_per_h: number;
  population: number;
  has_underpass: boolean;
  criticality: number;
  rain_factor: number;
  notes: string | null;
  centroid: [number, number]; // [lng, lat]
}

export interface ZoneFeature {
  type: "Feature";
  geometry: { type: "Polygon"; coordinates: number[][][] };
  properties: ZoneProperties;
}

export interface ZoneCollection {
  type: "FeatureCollection";
  features: ZoneFeature[];
}

export interface ReplayMeta {
  start_ts: string;
  end_ts: string;
  tick_minutes: number;
  n_ticks: number;
  peak_tick: number;
  rain_source: string;
  risk_source: string;
  seeded_at: string;
}

export interface ZoneSeries {
  rain: number[];
  cum_3h: number[];
  exceedance: number[];
  depth_cm: number[];
  risk: number[];
  flooded: boolean[];
}

export interface KpiSeries {
  active_alerts: number[];
  zones_at_risk: number[];
  zones_flooded: number[];
  assets_deployed: number[];
  population_affected: number[];
  lead_time_min: (number | null)[];
}

export interface Timeline {
  meta: ReplayMeta;
  ts: string[];
  city_rain: number[];
  zones: Record<string, ZoneSeries>;
  kpis: KpiSeries;
}

export interface Alert {
  id: number;
  ts: string;
  tick: number | null;
  zone_id: string;
  severity: Severity;
  type: string;
  message_en: string;
  message_ar: string;
  rule_id: string;
  rule_version: string;
  status: string;
  cleared_ts: string | null;
  cleared_tick: number | null;
}

export interface Asset {
  id: string;
  callsign: string;
  callsign_ar: string;
  type: "pump_truck" | "tanker" | "crew";
  capacity_m3_h: number;
  lat: number;
  lng: number;
  depot_id: string | null;
  zone_id: string | null;
  status: "idle" | "staged" | "enroute" | "pumping";
}

export interface Contribution {
  driver: string;
  points: number;
}

export interface ZoneExplanation {
  zone_id: string;
  tick: number;
  risk: number;
  band: Band;
  contributions: Contribution[];
  inputs: Record<string, number | boolean>;
}

export interface Meta {
  app: string;
  version: string;
  database_ok: boolean;
  replay: ReplayMeta | null;
  counts: Record<string, number>;
  physics: {
    source: string;
    flood_depth_cm: number;
    bands: { yellow: number; orange: number; red: number };
    formula: string;
  };
  features: { gemini: boolean; flood_mcp_live: boolean };
  disclaimers: { en: string; ar: string };
}

export interface LiveWeather {
  available: boolean;
  source: string;
  fetched_at: string | null;
  error: string | null;
  current: Record<string, number | string> | null;
  hourly: { ts: string; precipitation_mm: number; probability_pct: number | null }[];
}

export interface LiveZoneState {
  zone_id: string;
  rain_mm_h: number;
  cum_3h_mm: number;
  exceedance_mm_h: number;
  depth_cm: number;
  flooded: boolean;
  risk: number;
  band: Band;
}

export interface LiveState {
  available: boolean;
  source: string;
  fetched_at: string | null;
  city_rain_mm_h: number;
  zones: LiveZoneState[];
}

export interface AgentStatus {
  name: string;
  name_ar: string;
  online: boolean;
  phase: number;
  gemini_key_present: boolean;
  model: string;
  notice_en: string;
  notice_ar: string;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new ApiError(res.status, `${res.status} ${res.statusText} for ${path}`);
  return (await res.json()) as T;
}

export const endpoints = {
  meta: "/api/meta",
  zones: "/api/zones",
  timeline: "/api/replay/timeline",
  alerts: "/api/alerts",
  assets: "/api/assets",
  liveWeather: "/api/live/weather",
  liveState: "/api/live/state",
  agentStatus: "/api/agent/status",
  explain: (zoneId: string, tick: number) => `/api/zones/${zoneId}/explain?tick=${tick}`,
} as const;
