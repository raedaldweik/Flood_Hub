/**
 * Typed client for the FastAPI backend. Hand-mirrors backend/sadd/api/schemas.py —
 * keep the two in sync (a generated OpenAPI client is a Phase-4 nicety, not a need).
 */

/**
 * Where the browser reaches FastAPI.
 *  - Production image: empty → same origin (FastAPI serves the static export itself).
 *  - `next dev` on :3000: FastAPI on http://localhost:8000.
 * A configured localhost base is ignored when the page itself is not on localhost, so a
 * copied-over dev value (e.g. Railway's "suggested variables" from .env.example) cannot
 * break a hosted deployment.
 */
function resolveApiBase(): string {
  const configured = (process.env.NEXT_PUBLIC_API_BASE ?? "").trim();
  if (typeof window === "undefined") return configured || "http://localhost:8000";
  const here = window.location;
  const pageIsLocal = /^(localhost|127\.0\.0\.1)$/.test(here.hostname);
  const baseIsLocal = /localhost|127\.0\.0\.1/.test(configured);
  if (configured && (pageIsLocal || !baseIsLocal)) return configured;
  return pageIsLocal && here.port === "3000" ? "http://localhost:8000" : "";
}

export const API_BASE = resolveApiBase();

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
  /** Who produced the contributions: the XGBoost nowcast (TreeSHAP) or the physics baseline. */
  source: string;
  model_risk: number | null;
  baseline: number | null;
  contributions: Contribution[];
  inputs: Record<string, number | boolean>;
}

export type StartupPhase = "starting" | "waiting_db" | "seeding" | "ready" | "seed_failed";
/** Reported by the backend while it waits for Postgres and seeds the replay in the background. */
export interface StartupState {
  phase: StartupPhase;
  detail: string;
  attempts: number;
  seconds: number;
}

export interface Meta {
  app: string;
  version: string;
  database_ok: boolean;
  startup: StartupState;
  replay: ReplayMeta | null;
  counts: Record<string, number>;
  physics: {
    source: string;
    flood_depth_cm: number;
    bands: { yellow: number; orange: number; red: number };
    formula: string;
  };
  models: {
    available: boolean;
    risk: { source: string; metrics?: { r2: number; mae: number }; importances?: Record<string, number> };
    time_to_drain: { source: string; metrics?: { r2: number; mae_h: number }; formula: string };
  };
  features: { gemini: boolean; flood_mcp_live: boolean };
  disclaimers: { en: string; ar: string };
}

/** Risk-lit towers: OpenStreetMap footprints with heights, tagged with the zone they stand in. */
export interface BuildingProperties {
  osm_id: number;
  name: string | null;
  height_m: number;
  levels: number | null;
  zone_id: string | null;
  centroid: [number, number];
}
export interface BuildingFeature {
  type: "Feature";
  geometry: { type: "Polygon"; coordinates: number[][][] };
  properties: BuildingProperties;
}
export interface BuildingCollection {
  type: "FeatureCollection";
  features: BuildingFeature[];
  properties?: { available?: boolean; count?: number; source?: string; fetched_at?: string };
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
  tools?: {
    db: "toolbox" | "local";
    toolbox_url: string;
    flood_mcp: { transport: string; backend: string };
    rag: "pgvector" | "keyword";
    models: string;
  };
  notice_en: string;
  notice_ar: string;
}

export interface Citation {
  doc_id: string;
  doc_title: string;
  section_no: string;
  section: string;
  lang: string;
}

export interface PlanZone {
  zone_id: string;
  pumps: number;
  peak_band: Band;
  time_to_drain_h: number;
  baseline_time_to_drain_h: number;
  flooded_h: number;
  population: number;
}

export interface DispatchPlan {
  plan_id: string;
  status: "proposed" | "approved" | "rejected";
  objective: string;
  tick: number | null;
  storm_multiplier: number;
  prepositioned: boolean;
  fleet_size: number;
  allocations: Record<string, number>;
  zones: PlanZone[];
  expected: Record<string, number>;
  baseline: Record<string, number>;
  delta: Record<string, number>;
  rule: string;
  result?: { decision_id: number; rule: string; approved_by: string; trucks_moved: number };
}

export interface AdvisoryDraft {
  status: "DRAFT";
  zone_id: string;
  severity: string;
  template: string;
  sms_en: string;
  sms_ar: string;
  chars_en: number;
  chars_ar: number;
  note: string;
}

export interface Depot {
  id: string;
  name_en: string;
  name_ar: string;
  lat: number;
  lng: number;
}

/** POST /api/sim/simulate — the Simulation Lab's what-if request (mirrors ScenarioIn). */
export interface ScenarioIn {
  storm_multiplier: number;
  allocations: Record<string, number>;
  prepositioned: boolean;
  drain_upgrade_pct: number;
}

export interface SimZone {
  zone_id: string;
  pumps: number;
  peak_risk: number;
  peak_band: Band;
  peak_depth_cm: number;
  flooded_h: number;
  first_flood_tick: number | null;
  time_to_drain_h: number;
  damage_qar: number;
  population: number;
  has_underpass: boolean;
}

export interface SimKpis {
  zones_flooded: number;
  zones_red: number;
  zones_at_risk: number;
  all_clear_h: number;
  total_flooded_h: number;
  population_affected: number;
  roads_closed_km: number;
  damage_qar: number;
  pumps_deployed: number;
}

export interface SimResult {
  scenario: ScenarioIn;
  zones: SimZone[];
  kpis: SimKpis;
  baseline: SimKpis;
  delta: SimKpis;
  sources: { risk: string; time_to_drain: string };
  assumptions: Record<string, unknown> & { note: string };
  elapsed_ms: number;
  fleet_size?: number;
}

export interface Rule {
  id: string;
  version: string;
  name_en: string;
  name_ar: string;
  description_en: string;
  description_ar: string;
  kind: "timeline" | "gate";
  test_count: number;
}

export type Proposer = "system" | "agent" | "operator";

/** One row of the decision ledger (decision_log). */
export interface Decision {
  id: number;
  ts: string;
  tick: number | null;
  decision_type: string;
  zone_id: string | null;
  rule_id: string;
  rule_version: string;
  inputs_json: Record<string, unknown>;
  output_json: Record<string, unknown>;
  proposed_by: Proposer;
  approved_by: string | null;
  notified: boolean;
  source: string;
}

export interface Pair<T = number> {
  actual: T;
  sadd: T;
}

export interface ExecutiveReport {
  event: { start_ts: string | null; end_ts: string | null; peak_ts: string | null; rain_source: string | null; city_rain_total_mm: number };
  scorecards: {
    alert_lead_time_min: Pair;
    preposition_lead_time_min: Pair;
    time_to_drain_h: Pair;
    population_protected: Pair;
    road_closure_h: Pair & { km_affected: number };
    avoided_damage_qar: Pair;
    asset_utilisation_pct: Pair & { live: number };
  };
  comparison: { key: string; actual: number; sadd: number }[];
  scenarios: { no_pumps: SimKpis; reactive: SimKpis; prepared: SimKpis; allocations: Record<string, number>; fleet_size: number; reactive_delay_h: number; sources: { risk: string; time_to_drain: string } };
  lead: { alert_lead_time_min: number; preposition_lead_time_min: number; zones_flooded: number; zones_warned_before_flooding: number; population_protected: number; population_flooded_zones: number };
  trend: { tick: number; ts: string; city_rain_mm_h: number; active_alerts: number; zones_at_risk: number; zones_flooded: number }[];
  alerts: { total: number; by_severity: Record<string, number>; zones_alerted: number };
  decisions: { total: number; by_rule: Record<string, number>; by_proposer: Record<string, number>; operator_approved: number };
  fleet: { pump_trucks: number; pump_trucks_active: number; utilisation_pct: number; by_status: Record<string, number> };
  summary: { text: string; source: "template" | "gemini"; model: string | null };
  assumptions: { actual: string; sadd: string; damage: string; damage_constants: Record<string, number>; gcp: string };
}

/** One `data:` line of the /api/agent/chat stream. */
export type ChatEvent =
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; summary: string }
  | { type: "citations"; method: string; items: Citation[] }
  | { type: "plan"; plan: DispatchPlan }
  | { type: "draft"; draft: AdvisoryDraft }
  | { type: "text"; delta: string }
  | { type: "error"; message: string }
  | { type: "done"; offline?: boolean };

/** POST the chat turn and yield parsed SSE events (fetch streaming, same origin, no EventSource GET limits). */
export async function* streamChat(body: {
  message: string;
  session_id: string;
  lang: "en" | "ar";
  tick: number;
  mode: "replay" | "live";
}): AsyncGenerator<ChatEvent> {
  const res = await fetch(`${API_BASE}/api/agent/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new ApiError(res.status, `${res.status} ${res.statusText} for /api/agent/chat`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data:"));
      if (line) yield JSON.parse(line.slice(5).trim()) as ChatEvent;
    }
  }
}

export async function approvePlan(planId: string, operatorId = "operator-01"): Promise<{ plan_id: string; status: string; result: DispatchPlan["result"] }> {
  const res = await fetch(`${API_BASE}/api/agent/plans/${planId}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operator_id: operatorId }),
  });
  const data = await res.json();
  if (!res.ok) throw new ApiError(res.status, JSON.stringify(data.detail ?? data));
  return data;
}

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail ?? data));
  return data as T;
}

/** Stateless what-if (well under 300 ms on the backend, so sliders feel live). */
export function simulate(scenario: ScenarioIn, signal?: AbortSignal): Promise<SimResult> {
  return postJson<SimResult>("/api/sim/simulate", scenario, signal);
}

/** Rafid's planner tool called directly — deterministic, sub-second, works with Gemini offline. */
export function proposePlan(body: { objective?: string; storm_multiplier: number; tick?: number | null; lang: "en" | "ar" }): Promise<DispatchPlan> {
  return postJson<DispatchPlan>("/api/agent/plans/propose", body);
}

/** R-08: the operator returns every unit to its depot. */
export function standDown(operatorId = "operator-01", tick?: number): Promise<{ decision_id: number; rule: string; units_returned: number; fleet_size: number }> {
  return postJson("/api/agent/fleet/stand-down", { operator_id: operatorId, tick });
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
  buildings: "/api/buildings",
  timeline: "/api/replay/timeline",
  alerts: "/api/alerts",
  assets: "/api/assets",
  liveWeather: "/api/live/weather",
  liveState: "/api/live/state",
  agentStatus: "/api/agent/status",
  depots: "/api/depots",
  rules: "/api/rules",
  decisions: "/api/decisions?limit=1000",
  simBaseline: "/api/sim/baseline",
  executive: (lang: "en" | "ar") => `/api/executive?lang=${lang}`,
  explain: (zoneId: string, tick: number) => `/api/zones/${zoneId}/explain?tick=${tick}`,
} as const;
