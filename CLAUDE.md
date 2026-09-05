# CLAUDE.md — PROJECT SADD (سد)

AI-Powered Urban Flood Command & Preparedness Twin for a Gulf City (Doha)

## 0. READ THIS FIRST — THE MISSION

This is not a toy project. This demo will be presented at a Google Cloud Customer Engineer final interview by Raed, a GenAI presales engineer. The panel are senior cloud engineers in Doha. The demo must make them speechless. The bar is: "a junior candidate built a flood command digital twin on a photorealistic 3D model of our own city, with real ML, real agents, real MCP servers, and real governance — in five days."

Quality bar, non-negotiable:

* Cinematic. Smooth camera moves on the 3D map, polished dark command-center UI, zero jank, zero placeholder-looking widgets. Every screen must look like a national operations center, not a hackathon project.
* Honest. Simulated data is labeled as simulated. Live data is labeled live. Nothing fake-branded as Google or as a real government entity.
* Explainable. Every architectural decision in this file exists so Raed can defend it in Q&A. Do not silently deviate from this spec. If something in this spec is technically impossible, STOP and say so rather than substituting something else.
* Runs flawlessly on localhost for a 30-minute screen-shared presentation over Google Meet. Demo failure = interview failure. Prefer boring-reliable over clever-fragile everywhere except the visuals, where we want spectacular.

Raed's strengths: React/Next.js, maps (ex-Mapbox specialist), Python, ML, RAG, agents, MCP (built several at SAS). Build in his idioms so he can explain and modify every file.

Raed currently has ZERO API keys. Section 12 lists every key needed, where to get it, and requires the app to run gracefully with keys missing (feature-flagged fallbacks) so he can build incrementally while keys arrive.

## 1. BUSINESS CONTEXT (this drives every screen)

### The problem

Gulf cities are hyper-arid but catastrophically flood-prone. Rainfall is rare, so urban drainage was historically under-built; when extreme rain arrives, it lands on impermeable surfaces (concrete, asphalt) with limited natural absorption, overwhelming drainage within hours. There are no rivers — this is urban flash flooding, not riverine flooding.

Real anchor events (verify exact figures during build; use approximations in UI copy marked "based on historical data"):

* April 2024 Gulf storm: the same system that gave Dubai its heaviest rainfall on record (~250mm in ~24h, roughly 1.5–2 years of rain in a day) also hit Qatar hard. THIS is our replay event.
* October 20, 2018 Doha: roughly a year's rainfall in a single day; streets and underpasses submerged; national-memory event.

### Who we are helping (fictional, no real names/logos)

The demo persona is the "Doha Flood Operations Center (FOC)" — a fictional joint operations room combining what in reality would be the municipality, the public works/drainage authority, and civil defense. Do NOT use real entity names or logos anywhere in the UI. In code comments and docs, refer only to "the municipality," "public works," "civil defense."

### What flood operations actually do (researched domain reality — the dashboard must reflect these real workflows)

BEFORE the storm (preparedness — this is where AI adds the most value):

1. Monitor weather forecasts; estimate WHERE and WHEN impact will hit hardest.
2. Pre-position mobile pump trucks and water tankers at known hotspots (underpasses, low-lying districts) — Gulf cities famously deploy large tanker/pump fleets because fixed drainage is limited.
3. Inspect and clear storm drains and gullies in forecast-risk zones.
4. Stage sandbags and temporary barriers at critical facilities (hospitals, substations, metro entrances, underpasses).
5. Issue public advisories (SMS/cell-broadcast style), school/work advisories, traffic diversion plans.
6. Put crews on standby rosters.

DURING the storm (response): 7. Dispatch and re-route pump trucks as zones flood; track time-to-drain. 8. Close and divert roads; protect critical infrastructure; coordinate rescues. 9. Continuous situational awareness: which zones, how deep, trending worse or better.

AFTER (recovery): water removal, damage assessment, insurance claims, infrastructure review.

### The demo's value proposition (say this on every level of the app)

Move the city from reactive (2018/2024 reality: respond after streets flood) to predictive (forecast zone-level risk hours ahead; pre-position assets; alert earlier).

Measurable success criteria (these exact KPIs appear in the Executive tab)

* Alert lead time: minutes/hours of warning before a zone floods (target: hours, vs ~0 historically)
* Time-to-drain per zone: hours to clear floodwater (driven by pump allocation — the simulation lever)
* Population protected: residents in zones that received early alerts
* Roads kept open: km of key roads kept passable via pre-positioning and diversion
* Estimated avoided damage (QAR): modeled comparison of "April 2024 as it happened" vs "April 2024 with SADD"
* Asset utilization: % of pump fleet actively deployed vs idle

## 2. THE STORY THE DEMO TELLS (3 acts — the UI must serve this exact narrative)

Act 1 — REPLAY (Command Center tab): "This is April 2024. This rain actually fell." Time scrubber set to the storm; press play; rain intensity climbs; zones turn yellow→orange→red on the 3D city; alerts fire in the feed; Rafid (the agent) summarizes the situation on request, in Arabic and English. Gut-punch line: "In 2024 the response was reactive. Watch what proactive looks like."

Act 2 — LIVE (same tab, mode toggle): Flip to Live. Today's real weather over Doha (live API), calm map, green zones. Ten seconds. Proves the pipeline is real, not a movie.

Act 3 — SIMULATE (Simulation Lab tab): "Let's make it worse than 2024." Storm multiplier slider to 150%. Zones flip red. The rules engine fires alerts (visible in decision log). Rafid proposes a pump reallocation plan; the operator APPROVES it (human-in-the-loop click); pump markers move on the map; time-to-drain per zone recalculates and visibly drops. Then Response tab shows the decision log; Executive tab shows the money.

The presenter will narrate; the UI must never fight the narration. Every act transition = one click.

## 3. PRODUCT SPEC — FOUR TABS + OMNIPRESENT AGENT

Global UI: dark command-center theme. Suggested palette: near-black navy background (#0A0E1A-ish), white/soft-gray text, risk colors green (#22c55e) / yellow (#eab308) / orange (#f97316) / red (#ef4444), one accent (electric cyan or Google blue) used sparingly. Typography: Inter or similar; big confident numbers for KPIs. Subtle glassmorphism cards ok; NO light mode. Arabic/English toggle in the header switches ALL UI copy + agent language (i18n from day one; RTL support when Arabic active). A small "SIMULATED DATA" / "LIVE DATA" pill must always show the current data mode — honesty is a feature.

### Tab 1 — COMMAND CENTER (default; Acts 1 & 2)

* Hero: photorealistic 3D map of Doha (Google Maps JS API `Map3DElement`, photorealistic 3D). Initial camera: cinematic establishing angle over the city, slow drift. Smooth `flyCameraTo` transitions when user clicks a zone or alert.
* Zone risk layer: ~10–12 fictional-but-plausible district polygons (use real Doha district names for realism: West Bay, Al Sadd, Al Rayyan, Madinat Khalifa, Najma, Al Mansoura, Old Airport, Al Wakrah edge, Industrial Area, Airport zone, Corniche, Education City area). Draped/extruded polygons on the 3D map colored by current risk score, with opacity ~0.5 so buildings show through. Clicking a zone opens a detail card: current rain intensity, drainage capacity, risk score + WHY (top model features), population, assets on site, active alerts.
* KPI strip (top): Active Alerts | Zones at Risk | Assets Deployed | Population in Affected Zones | Current Alert Lead Time. Operational numbers only (NO "model accuracy" on the ops screen).
* Alert feed (side): newest first; severity chips; click → camera flies to zone.
* Rain panel (small, collapsible): current city rainfall intensity chart (last 24h + next 12h forecast line).
* Time controls (bottom): mode toggle [REPLAY April 2024 | LIVE]. In replay: scrubber across the storm timeline with play/pause and speed (1x/5x/20x). In live: shows today's date + live weather source label.
* The whole tab must work beautifully at 1080p over screen share.

### Tab 2 — SIMULATION LAB (Act 3)

* Same 3D map (or synchronized second instance) with a control rail:
   * Storm intensity slider: 50%–200% of the April 2024 event. Re-scores all zones live via the risk model.
   * Pump fleet allocator: total fleet size (e.g., 24 trucks) with per-zone allocation (+/- steppers or drag). For each flooded zone show time-to-drain recomputed live from the drainage model. Global readout: "All zones clear in X hours."
   * Preparedness toggles: "Pre-positioned assets" on/off (moves deployment 6h earlier → shows lead-time and damage delta), "Drain network upgraded +20%" (infrastructure what-if).
* Before/after strip: compact side-by-side of baseline vs current scenario KPIs (peak zones flooded, total time-to-drain, est. damage QAR).
* Rafid integration: an "Ask Rafid to optimize" button → agent proposes an allocation plan (JSON plan rendered as cards) → operator clicks APPROVE → allocation applies with animated pump marker movements on the map. The agent NEVER auto-applies. (See §7 governance.)

### Tab 3 — RESPONSE & GOVERNANCE

* Dispatch board: table/cards of pump trucks & crews (id, type, capacity m³/h, assigned zone, status: staged/en-route/pumping/idle), with map mini-view of asset positions. Fictional commander names for theater (e.g., "Maj. Khalid Al-Marri — Traffic Diversion", clearly fictional).
* THE DECISION LOG (the thesis made visible): every alert/dispatch decision as an immutable-looking ledger: timestamp | decision (e.g., "RED ALERT — Najma") | authorized by RULE `R-04 v1.2` | rule inputs snapshot (rain mm/h, risk score, threshold) | proposer (system / Rafid-proposed / operator) | approver (operator id) | notification sent. Filterable. This screen answers "how do you govern AI?" without saying a word.
* Rule catalog panel: the deterministic rules listed with versions and plain-language descriptions (e.g., R-01: "Risk ≥ 80 for 2 consecutive intervals → RED alert + SMS advisory"; R-04: "Underpass zone + rain > Xmm/h → close underpass, divert traffic"). Emphasize: rules are versioned code, testable, auditable.

### Tab 4 — EXECUTIVE VIEW

* Clean, lighter-density analytics for a minister persona: the §1 KPIs as scorecards; "April 2024 actual vs with-SADD" comparison bars (damage QAR, road-closure hours, alert lead time); incident trend; asset utilization; a one-line summary sentence generated by Rafid ("This month: X alerts, Y hours average lead time, Z QAR estimated avoided damage.").
* Build with recharts (draft 1). A visible note in the code: "GCP version: Looker Studio embed."

### RAFID (رافد) — THE AGENT PANEL (docked right, present on ALL tabs)

* Name meaning: "tributary / one who supports" — mention in the About tooltip.
* Chat UI: streaming responses, Arabic & English (auto-follow the UI language toggle; also answer in whichever language the user types), message-level citation chips when RAG is used, and a visible tool-call trace (collapsible "Rafid used: flood-mcp → get_flood_status(zone=najma)" lines) — the builders in the room must SEE the MCP calls.
* Capabilities (each maps to a tool in §7):
   1. Situational Q&A: "What happened at 14:00?" "Which zones are critical right now?" (queries DB via MCP Toolbox)
   2. Risk scoring on demand: "Score West Bay if rain doubles" (model tool)
   3. Flood data lookups: gauges/status via the custom Flood Forecasting MCP
   4. Protocol Q&A with citations: "What is the evacuation protocol for underpasses?" (RAG)
   5. Plan proposal: "Optimize pump allocation" → returns a structured plan → requires operator APPROVE (never self-executes)
   6. Drafting: bilingual public advisory SMS drafts (returned as text for operator review, clearly marked DRAFT)
* Personality: calm, precise, operational. No emojis. Answers grounded in data; if data is missing it says so.

## 4. ARCHITECTURE (Draft 1 — open source, runs locally; GCP migration is a config story)

Decision principle (quote in comments): "The LLM never makes the consequential decision. The rules engine decides; the agent explains, proposes, and cites. Everything is logged."

```
Next.js (4 tabs + Rafid panel, i18n AR/EN, Google 3D map)
        │ REST/SSE
FastAPI backend (single repo, clear modules)
 ├─ /api        app endpoints (zones, alerts, assets, kpis, replay ticks, sim)
 ├─ /rules      DETERMINISTIC decision engine (versioned rules, pure functions,
 │              unit-tested; writes decision_log; ONLY component that can
 │              create alerts/dispatches)
 ├─ /sim        replay engine (April-2024 timeline playback) + what-if math
 ├─ /models     risk nowcast + time-to-drain (scikit-learn/XGBoost, loaded once)
 └─ /agent     ADK agent "Rafid" (Gemini API), tools wired via MCP + local tools
PostgreSQL + PostGIS + pgvector  (zones, rain_readings, assets, alerts,
                                  decision_log, protocol_chunks)
MCP layer:
 ├─ MCP Toolbox for Databases (Google OSS) → Postgres  [swap-to-BigQuery story]
 └─ flood-forecasting-mcp (CUSTOM, ours, FIRST OF ITS KIND):
      implements Google's PUBLIC Flood Forecasting API contract
      (searchGaugesByArea, queryGaugeForecasts, queryLatestFloodStatus…)
      backed by simulated gauges + Google's open historical flood datasets;
      designed to swap to the real API when pilot access clears (env flag)
External:
 ├─ Google Maps JS API — Photorealistic 3D (key required)
 ├─ Gemini API (key required; ADK model)
 └─ Open-Meteo (live + historical weather; NO KEY — use for April 2024 replay
    data and today's live Doha weather)
```

Why these choices (Raed must be able to recite):

* Postgres+PostGIS+pgvector: one database for relational, geospatial, and vectors in draft 1 = fewest moving parts on demo day; each concern maps 1:1 to a GCP service later (BigQuery / Vertex AI Search).
* Rules as code, separate module: consequential decisions must be versioned, testable, explainable — SAS Intelligent Decisioning pattern reimplemented as code, which is how GCP does it.
* ADK locally: same agent code local and on Agent Engine later — "only the runtime changed."
* MCP everywhere: standard contracts mean the Postgres→BigQuery move is configuration, not rearchitecture; and the custom flood MCP is a genuine ecosystem contribution (contract-first against a gated API).
* FastAPI monorepo, not microservices: right-sized for a demo; modular boundaries prove the architecture thinking without the operational tax (this is itself a talking point).

Migration map (put in README as a table): Postgres→BigQuery · sklearn→BigQuery ML · pgvector→Vertex AI Search · FastAPI→Cloud Run · ADK local→Vertex AI Agent Engine · recharts exec tab→Looker Studio · MCP Toolbox(Postgres)→managed BigQuery MCP server · custom flood MCP→same, pointed at live API.

## 5. DATA MODEL (Postgres)

* `zones(id, name_en, name_ar, geom POLYGON, area_km2, elevation_m, imperviousness_pct, drainage_capacity_mm_per_h, population, has_underpass bool, criticality int)`
* `rain_readings(ts, zone_id, intensity_mm_h, cumulative_mm, source ENUM('replay_2024','live','simulated'))`
* `flood_state(ts, zone_id, water_depth_cm, flooded bool)` ← derived by sim engine
* `assets(id, callsign, type ENUM('pump_truck','tanker','crew'), capacity_m3_h, lat, lng, zone_id nullable, status ENUM('idle','staged','enroute','pumping'))`
* `alerts(id, ts, zone_id, severity ENUM('yellow','orange','red'), type, message_en, message_ar, rule_id, status)`
* `decision_log(id, ts, decision_type, zone_id, rule_id, rule_version, inputs_json, output_json, proposed_by ENUM('system','agent','operator'), approved_by, notified bool)`
* `protocol_chunks(id, doc_title, section, lang, content, embedding vector)`
* `gauges(id, name, lat, lng, type ENUM('virtual','simulated'))` + `gauge_forecasts(gauge_id, issued_ts, lead_h, value, severity)` ← backing tables for the custom flood MCP

Synthetic data generation (a seed script, `make seed`)

* Zones: hand-crafted GeoJSON of ~10–12 Doha districts (approximate real district boundaries; simplified polygons are fine; must LOOK right on the 3D map). Give each realistic-ish attributes; underpass zones get low drainage + high criticality.
* April 2024 replay: pull REAL hourly rainfall for Doha for the storm dates from Open-Meteo's historical API at seed time; distribute across zones with plausible spatial variation (coastal vs inland multipliers + noise). Label source='replay_2024'. If the API is unreachable at seed time, fall back to a bundled CSV with a realistic storm curve (calm → building → violent peak ~4h → tapering).
* Assets: 24 pump trucks + 8 tanker crews with Arabic-style callsigns, staged at plausible depot locations.
* Protocols (RAG corpus): GENERATE ~8–10 short fictional-but-realistic civil-defense protocol documents in BOTH English and Arabic (underpass closure protocol, pump deployment SOP, sandbag placement guide, school advisory procedure, hospital protection checklist, public SMS advisory templates, evacuation escalation ladder). 300–600 words each, numbered sections so citations look real. Mark every doc footer: "Fictional training document for demo purposes."
* Training data for models: simulate ~5k labeled rows from a physical-intuition generator (see §6) so the models learn real monotonic relationships, not noise.

## 6. THE TWO ML MODELS (traditional AI — must be real trained models, not if-statements)

1. Zone Flood-Risk Nowcast (XGBoost classifier/regressor → risk 0–100): features: rain intensity (mm/h), 3h cumulative rain, drainage capacity, imperviousness, elevation percentile, has_underpass. Generate training data from a transparent physics-ish rule (runoff ≈ rain × imperviousness − drainage, thresholded to risk bands) + noise, so the model recovers sensible feature importances. Expose feature importance in the zone detail card ("why is this zone red: rain 62mm/h vs drainage 18mm/h…"). Save with joblib; load at startup.
2. Time-to-Drain Forecast (gradient boosted regressor): features: standing water volume (zone area × depth), active pump capacity on zone (Σ m³/h), drainage capacity, still-falling rain. Trained on generated data around the mass-balance truth (hours ≈ volume ÷ (pumps + drainage − inflow)); the model adds realism/noise; the sim slider calls this live. Also expose the transparent formula in a tooltip — honesty about the physics.

(Keep a `models/train.py` that reproduces both in <60s. In the interview: "draft 1 trains locally with scikit-learn; on GCP both become BigQuery ML models — CREATE MODEL over the same tables, scored through the managed BigQuery MCP server.")

## 7. RULES ENGINE + GOVERNANCE (the demo's soul — do not cut corners here)

* Pure-function rules in `/rules/rules.py`, each with id, version, plain-language description, `evaluate(inputs) -> Decision|None`. Examples:
   * R-01 v1: risk ≥ 80 for 2 consecutive intervals → RED alert + advisory draft
   * R-02 v1: risk ≥ 60 → ORANGE alert
   * R-03 v1: RED alert + has_underpass → "close underpass, divert traffic" action item
   * R-04 v1: forecast risk ≥ 60 within 6h AND zone has 0 staged assets → "pre-position pumps" recommendation
   * R-05 v1: agent-proposed dispatch plan → validate fleet limits + zone eligibility; only then executable
* EVERY decision (fired or agent-proposed-then-approved) writes a full `decision_log` row.
* The agent can call `propose_dispatch_plan` but the ONLY path to changing asset state is `rules.validate_and_apply(plan, operator_id)` after a UI approve click. Enforce in code, not convention.
* Unit tests for every rule (pytest) — mention test count in README; it's a talking point.

## 8. RAFID AGENT (ADK + Gemini)

* Build with Google ADK (python), model = Gemini (flash tier default for speed; env-switchable). System prompt: operational tone, bilingual, ALWAYS ground in tool results, cite protocol sections, refuse to fabricate, never claim to execute actions (propose only).
* Tools:
   1. `db` toolset via MCP Toolbox for Databases → Postgres (zones, alerts, KPIs, history queries; read-only credentials)
   2. `flood` toolset via custom flood-forecasting-mcp (below)
   3. `score_zone(zone_id, rain_multiplier)` → local tool hitting /models
   4. `search_protocols(query, lang)` → pgvector RAG (top-k chunks + metadata for citations)
   5. `propose_dispatch_plan(objective)` → optimizer (simple greedy: allocate pumps proportional to volume/criticality) returning a structured plan
   6. `draft_advisory(zone, severity, lang)` → template+LLM SMS draft, marked DRAFT
* SSE/streaming to the UI; tool-call trace events forwarded so the panel renders "Rafid used: …" lines.
* Embeddings for RAG: use a strong multilingual OSS embedding model (e.g., BGE-M3 or multilingual-e5) OR Gemini embeddings API — pick ONE, note the choice + swap note (→ Vertex AI Search on GCP).

## 9. CUSTOM MCP SERVER — `flood-forecasting-mcp` (the crown jewel; own top-level folder + own README)

* Python MCP server (official `mcp` SDK) exposing tools that MIRROR Google's public Flood Forecasting API contract: `search_gauges_by_area(min_lat,min_lng,max_lat,max_lng)`, `get_gauge(gauge_id)`, `query_gauge_forecasts(gauge_ids, from_ts, to_ts)`, `query_latest_flood_status(gauge_ids)` — same field names/enums as the published schema (severity, trend, inundation levels) wherever practical.
* Backend adapter pattern with env flag `FLOOD_MCP_BACKEND = simulated | live`:
   * `simulated`: serves our gauges/gauge_forecasts tables (Doha virtual gauges tied to zones)
   * `live`: stubbed client for the real API (waitlist-gated) — implemented, documented, disabled until access granted
* README must state, verbatim-spirit: "Google's Flood Forecasting API is pilot-gated. This server is built contract-first against the published API specification and runs on simulated + open historical data; it switches to the live API with one environment variable when pilot access is granted. To our knowledge this is the first MCP server for Google's Flood Forecasting API."
* MIT or Apache-2.0 license; clean enough to open-source proudly.

## 10. SIMULATION ENGINE

* Replay: precomputed April-2024 timeline in DB; a tick endpoint (or SSE stream) advances t; each tick updates rain → model rescores → rules evaluate → flood_state/alerts/decision_log mutate → frontend animates. Scrubber = seek to tick. 20x speed must stay smooth (precompute per-tick state at seed time if needed — smoothness beats realism).
* What-if: stateless endpoint `simulate(storm_multiplier, allocations, toggles)` → per-zone risk, depth, time-to-drain, KPI deltas vs baseline. <300ms responses so sliders feel live.
* Physics honesty: keep the mass-balance transparent and documented; this is a decision-support demo, not a hydrological model — say so in README (and Raed will say it in Q&A; it's a maturity flex, cf. flood-hub riverine vs urban gap).

## 11. REPO & DX

```
sadd/
├─ CLAUDE.md (this file)
├─ README.md (hero screenshot, story, arch diagram, migration table, quickstart)
├─ docker-compose.yml (postgres+pgvector; optional: everything)
├─ Makefile (make setup / seed / train / dev / test)
├─ frontend/ (Next.js, TS, tailwind, i18n AR-EN with RTL)
├─ backend/ (FastAPI: api/ rules/ sim/ models/ agent/)
├─ flood-forecasting-mcp/ (own package + README + license)
└─ data/ (geojson, seeds, fallback storm csv, protocol docs EN/AR)
```

* TypeScript strict; Python typed; pytest for rules+sim; meaningful commit history if possible (spec-first story).
* `.env.example` with EVERY variable documented.
* Feature flags: `MAPS_KEY missing → render dark 2D fallback map (maplibre) with a banner "3D requires Google Maps key"`; `GEMINI_KEY missing → Rafid replies with a static notice`; app must never crash from a missing key.

## 12. API KEYS RAED MUST OBTAIN (he has NONE today — build so these slot in via .env)

1. Google Maps Platform (for Photorealistic 3D): create GCP project → enable Maps JavaScript API AND Map Tiles API → create API key, restrict to localhost referrer. Billing account required (free monthly credit covers demo use; set a budget alert). Env: `NEXT_PUBLIC_GOOGLE_MAPS_KEY`.
2. Gemini API key (for ADK + embeddings if chosen): via Google AI Studio — free tier fine. Env: `GEMINI_API_KEY`.
3. Open-Meteo: NO key. Historical + forecast endpoints for Doha (lat 25.28, lng 51.53).
4. Flood Forecasting API: WAITLIST ONLY (Raed is applying) — build the `live` adapter stubbed + documented; do not block on it.
5. Nothing else. No Mapbox (Google 3D replaces it), no paid weather APIs.

## 13. FIVE-DAY BUILD ORDER (each phase ends demoable)

* P1 (Day 1): repo scaffold, docker postgres, schema+seed (zones GeoJSON, April-2024 rain via Open-Meteo, assets, protocols), 3D map rendering Doha with risk-colored zone polygons from DB, KPI strip live. Done = the money screen exists.
* P2 (Day 2): models trained+served; replay engine + scrubber + animated Act 1; rules R-01..R-05 + alerts + decision_log; live-weather mode. Done = Acts 1&2 work.
* P3 (Day 3): flood-forecasting-mcp; MCP Toolbox wired; Rafid with all 6 tools, bilingual, streaming, tool-trace, citations; approval flow. Done = agent wows.
* P4 (Day 4): Simulation Lab (sliders, allocator, before/after), Response & Governance tab (dispatch board + decision log + rule catalog), Executive tab, polish pass (cameras, transitions, empty states, AR/RTL audit). Done = all four tabs final.
* P5 (Day 5, with Raed): rehearsal fixes only. NO new features. Freeze.

## 14. DO-NOT LIST

* No real government names/logos; no Google logos in the UI; no "powered by Google" claims (using Google APIs ≠ endorsement).
* No LLM-fired alerts/dispatches — ever. Rules only.
* No unlabeled simulated data.
* No new features on day 5.
* No heavy 3D tricks that stutter on screen share — test at 1080p, throttled.
* Do not invent rainfall records as fact — label historical figures "approx., based on public reports."
