-- PROJECT SADD — schema (see CLAUDE.md §5). Idempotent: safe to re-run.
-- Everything here is synthetic demo data for a FICTIONAL operations center.

DO $$ BEGIN
  CREATE TYPE rain_source AS ENUM ('replay_2024', 'live', 'simulated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE asset_type AS ENUM ('pump_truck', 'tanker', 'crew');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE asset_status AS ENUM ('idle', 'staged', 'enroute', 'pumping');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE severity AS ENUM ('yellow', 'orange', 'red');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE proposer AS ENUM ('system', 'agent', 'operator');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE gauge_type AS ENUM ('virtual', 'simulated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Reference: districts ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS zones (
  id                          TEXT PRIMARY KEY,
  name_en                     TEXT NOT NULL,
  name_ar                     TEXT NOT NULL,
  geom                        geometry(Polygon, 4326) NOT NULL,
  area_km2                    DOUBLE PRECISION NOT NULL,
  elevation_m                 DOUBLE PRECISION NOT NULL,
  imperviousness_pct          DOUBLE PRECISION NOT NULL,
  drainage_capacity_mm_per_h  DOUBLE PRECISION NOT NULL,
  population                  INTEGER NOT NULL,
  has_underpass               BOOLEAN NOT NULL,
  criticality                 SMALLINT NOT NULL CHECK (criticality BETWEEN 1 AND 5),
  rain_factor                 DOUBLE PRECISION NOT NULL DEFAULT 1.0,  -- spatial multiplier vs city rain
  notes                       TEXT
);
CREATE INDEX IF NOT EXISTS zones_geom_idx ON zones USING GIST (geom);

-- ── Observations: rainfall (hourly, per zone) ───────────────────────────────
CREATE TABLE IF NOT EXISTS rain_readings (
  ts              TIMESTAMPTZ NOT NULL,
  zone_id         TEXT NOT NULL REFERENCES zones(id),
  intensity_mm_h  DOUBLE PRECISION NOT NULL,
  cumulative_mm   DOUBLE PRECISION NOT NULL,
  source          rain_source NOT NULL,
  PRIMARY KEY (ts, zone_id, source)
);

-- ── Replay timeline (precomputed at seed time; §10 "smoothness beats realism") ──
CREATE TABLE IF NOT EXISTS replay_meta (
  id            SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  start_ts      TIMESTAMPTZ NOT NULL,
  end_ts        TIMESTAMPTZ NOT NULL,
  tick_minutes  SMALLINT NOT NULL,
  n_ticks       INTEGER NOT NULL,
  peak_tick     INTEGER NOT NULL,
  rain_source   TEXT NOT NULL,          -- 'open-meteo-archive' | 'fallback-csv'
  risk_source   TEXT NOT NULL,          -- 'physics_v0' (Phase 1) | 'xgboost_v1' (Phase 2)
  seeded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS replay_ticks (
  tick            INTEGER PRIMARY KEY,
  ts              TIMESTAMPTZ NOT NULL UNIQUE,
  city_rain_mm_h  DOUBLE PRECISION NOT NULL
);

-- ── Derived: per-tick zone state (sim engine output) ────────────────────────
CREATE TABLE IF NOT EXISTS flood_state (
  tick            INTEGER NOT NULL REFERENCES replay_ticks(tick),
  ts              TIMESTAMPTZ NOT NULL,
  zone_id         TEXT NOT NULL REFERENCES zones(id),
  rain_mm_h       DOUBLE PRECISION NOT NULL,
  cum_3h_mm       DOUBLE PRECISION NOT NULL,
  exceedance_mm_h DOUBLE PRECISION NOT NULL,   -- runoff inflow above drainage capacity
  water_depth_cm  DOUBLE PRECISION NOT NULL,
  flooded         BOOLEAN NOT NULL,
  risk_score      DOUBLE PRECISION NOT NULL,   -- 0..100
  risk_source     TEXT NOT NULL,               -- 'physics_v0' | 'xgboost_v1'
  PRIMARY KEY (tick, zone_id)
);
CREATE INDEX IF NOT EXISTS flood_state_zone_idx ON flood_state (zone_id, tick);

-- ── Fleet ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS depots (
  id       TEXT PRIMARY KEY,
  name_en  TEXT NOT NULL,
  name_ar  TEXT NOT NULL,
  lat      DOUBLE PRECISION NOT NULL,
  lng      DOUBLE PRECISION NOT NULL
);
CREATE TABLE IF NOT EXISTS assets (
  id             TEXT PRIMARY KEY,
  callsign       TEXT NOT NULL,
  callsign_ar    TEXT NOT NULL,
  type           asset_type NOT NULL,
  capacity_m3_h  DOUBLE PRECISION NOT NULL,
  lat            DOUBLE PRECISION NOT NULL,
  lng            DOUBLE PRECISION NOT NULL,
  depot_id       TEXT REFERENCES depots(id),
  zone_id        TEXT REFERENCES zones(id),
  status         asset_status NOT NULL DEFAULT 'idle'
);

-- ── Governance: alerts + decision log (written ONLY by the rules engine) ───
CREATE TABLE IF NOT EXISTS alerts (
  id           BIGSERIAL PRIMARY KEY,
  ts           TIMESTAMPTZ NOT NULL,
  tick         INTEGER,
  zone_id      TEXT NOT NULL REFERENCES zones(id),
  severity     severity NOT NULL,
  type         TEXT NOT NULL,               -- 'zone_risk' | 'underpass_closure' | ...
  message_en   TEXT NOT NULL,
  message_ar   TEXT NOT NULL,
  rule_id      TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'cleared'
  cleared_ts   TIMESTAMPTZ,
  cleared_tick INTEGER,
  source       rain_source NOT NULL DEFAULT 'replay_2024'
);
CREATE INDEX IF NOT EXISTS alerts_ts_idx ON alerts (ts);

CREATE TABLE IF NOT EXISTS decision_log (
  id            BIGSERIAL PRIMARY KEY,
  ts            TIMESTAMPTZ NOT NULL,
  tick          INTEGER,
  decision_type TEXT NOT NULL,              -- 'alert' | 'clear' | 'action_item' | 'dispatch' | ...
  zone_id       TEXT REFERENCES zones(id),
  rule_id       TEXT NOT NULL,
  rule_version  TEXT NOT NULL,
  inputs_json   JSONB NOT NULL,             -- exact snapshot the rule saw
  output_json   JSONB NOT NULL,             -- what the rule decided
  proposed_by   proposer NOT NULL,
  approved_by   TEXT,                       -- operator id for human-in-the-loop decisions
  notified      BOOLEAN NOT NULL DEFAULT FALSE,
  source        rain_source NOT NULL DEFAULT 'replay_2024'
);
CREATE INDEX IF NOT EXISTS decision_log_ts_idx ON decision_log (ts);

-- ── Precomputed KPI series for the replay (one row per tick) ────────────────
CREATE TABLE IF NOT EXISTS replay_kpis (
  tick                 INTEGER PRIMARY KEY REFERENCES replay_ticks(tick),
  active_alerts        INTEGER NOT NULL,
  zones_at_risk        INTEGER NOT NULL,      -- risk >= 60
  zones_flooded        INTEGER NOT NULL,
  assets_deployed      INTEGER NOT NULL,
  population_affected  INTEGER NOT NULL,      -- residents of zones at risk
  lead_time_min        DOUBLE PRECISION       -- mean(first flood ts − first alert ts) over flooded zones
);

-- ── RAG corpus ──────────────────────────────────────────────────────────────
-- Embeddings: Gemini `gemini-embedding-001` at 768 dims (Phase 3). GCP swap: Vertex AI Search.
CREATE TABLE IF NOT EXISTS protocol_chunks (
  id          BIGSERIAL PRIMARY KEY,
  doc_id      TEXT NOT NULL,
  doc_title   TEXT NOT NULL,
  doc_version TEXT NOT NULL,
  section     TEXT NOT NULL,
  section_no  TEXT NOT NULL,
  lang        TEXT NOT NULL CHECK (lang IN ('en', 'ar')),
  content     TEXT NOT NULL,
  embedding   vector(768)
);
CREATE INDEX IF NOT EXISTS protocol_chunks_doc_idx ON protocol_chunks (doc_id, lang);

-- ── Backing tables for flood-forecasting-mcp (Phase 3) ──────────────────────
CREATE TABLE IF NOT EXISTS gauges (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  lat      DOUBLE PRECISION NOT NULL,
  lng      DOUBLE PRECISION NOT NULL,
  type     gauge_type NOT NULL,
  zone_id  TEXT REFERENCES zones(id)
);
CREATE TABLE IF NOT EXISTS gauge_forecasts (
  gauge_id   TEXT NOT NULL REFERENCES gauges(id),
  issued_ts  TIMESTAMPTZ NOT NULL,
  lead_h     SMALLINT NOT NULL,
  value      DOUBLE PRECISION NOT NULL,      -- forecast water depth, cm
  severity   TEXT NOT NULL,                  -- mirrors Flood Forecasting API enum
  PRIMARY KEY (gauge_id, issued_ts, lead_h)
);
