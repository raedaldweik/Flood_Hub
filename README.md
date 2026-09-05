# PROJECT SADD (سد) — Urban Flood Command & Preparedness Twin

**An AI-powered flood operations digital twin for a Gulf city (Doha), built on a
photorealistic 3D city model, with real ML, a deterministic rules engine, an ADK agent,
custom MCP servers and visible governance.**

> Persona: the fictional *Doha Flood Operations Center (FOC)*. No real entity is depicted.
> Simulated data is labelled simulated; live data is labelled live — always, in the header.

![Command Center — replay of the April 2024 storm at its peak (2D fallback map, no Maps key)](docs/screenshots/command-center-replay-fallback-map.png)

*Phase 1 screenshot on the MapLibre fallback (no Google Maps key, offline basemap tiles). With
`NEXT_PUBLIC_GOOGLE_MAPS_KEY` set the same view renders on Google's photorealistic 3D tiles.*

---

## The story (three acts, one click each)

| Act | Tab | What the room sees |
|-----|-----|--------------------|
| 1 — **Replay** | Command Center | 15–17 April 2024. Press play: rain climbs, zones turn yellow → orange → red on the 3D city, the rules engine fires alerts into the feed, the KPI strip moves. *"In 2024 the response was reactive."* |
| 2 — **Live** | Command Center | Flip the toggle: today's real Doha weather (Open-Meteo, no key), calm green city. Proves the pipeline is real. |
| 3 — **Simulate** | Simulation Lab | Storm ×1.5, pump-fleet allocator, Rafid proposes a plan, the operator **approves**, pumps move, time-to-drain drops. *(Phase 4)* |

## Why it matters

Gulf cities are hyper-arid and catastrophically flood-prone: rare rain lands on impervious
surfaces with under-built drainage and overwhelms it within hours. Response has been reactive.
SADD moves the city to **predictive** operations: zone-level risk hours ahead, pre-positioned
pump fleets, earlier alerts — with every consequential decision made by versioned rules and
logged, never by an LLM.

> **Decision principle** — "The LLM never makes the consequential decision. The rules engine
> decides; the agent explains, proposes, and cites. Everything is logged."

## Architecture (draft 1 — open source, local; GCP is a config story)

```
Next.js 15 (4 tabs + Rafid panel, AR/EN + RTL, Google Photorealistic 3D / MapLibre fallback)
        │ REST (SSE for the agent in Phase 3)
FastAPI  sadd/
 ├─ api/     zones · replay timeline · alerts · assets · rules · live weather · meta
 ├─ rules/   DETERMINISTIC engine — versioned pure functions; the ONLY writer of alerts
 ├─ sim/     physics_v0 baseline + April-2024 replay precompute (per-tick, smooth at 20×)
 ├─ models/  XGBoost risk nowcast + time-to-drain regressor            (Phase 2)
 └─ agent/   Rafid — Google ADK on Gemini, tools via MCP + local tools  (Phase 3)
PostgreSQL 16 + PostGIS + pgvector  (zones · rain · flood_state · assets · alerts ·
                                    decision_log · protocol_chunks · gauges)
MCP: MCP Toolbox for Databases → Postgres · flood-forecasting-mcp (custom, Phase 3)
External: Google Maps JS API (3D) · Gemini API · Open-Meteo (no key)
```

### Migration map

| Draft 1 (local, OSS) | GCP |
|---|---|
| Postgres + PostGIS | BigQuery (GEOGRAPHY) |
| scikit-learn / XGBoost | BigQuery ML (`CREATE MODEL` over the same tables) |
| pgvector RAG | Vertex AI Search |
| FastAPI | Cloud Run |
| ADK local runtime | Vertex AI Agent Engine (same agent code) |
| recharts Executive tab | Looker Studio embed |
| MCP Toolbox → Postgres | managed BigQuery MCP server |
| flood-forecasting-mcp (simulated) | same server, `FLOOD_MCP_BACKEND=live` |

## Quickstart

Prerequisites: Docker, Python 3.11+ (`uv` recommended), Node 20+.

```bash
cp .env.example .env                       # every key optional; app degrades gracefully
cp frontend/.env.local.example frontend/.env.local
make setup                                 # backend venv + frontend npm install
make db                                    # Postgres 16 + PostGIS + pgvector (docker compose)
make seed                                  # zones, April-2024 rain, replay precompute, rules, fleet, protocols
make dev                                   # FastAPI :8000 + Next.js :3000
```

Open <http://localhost:3000>. Press **play**. Space toggles playback.

`make test` runs the pytest suite (**28 tests** in Phase 1: physics baseline, every rule,
engine escalation/clear-down, replay math, API smoke).

### Keys (all optional — see `.env.example`)

| Variable | Purpose | Missing → |
|---|---|---|
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | Photorealistic 3D (enable **Maps JavaScript API** + **Map Tiles API**) | dark 2D MapLibre fallback with a banner |
| `GEMINI_API_KEY` | Rafid (ADK) + embeddings (Phase 3) | Rafid shows an offline notice |
| — | Open-Meteo needs **no key** | seed falls back to a bundled synthetic storm curve, clearly labelled |

## Data honesty

* **Rain**: `make seed` pulls hourly Doha precipitation for 15–17 April 2024 from Open-Meteo's
  ERA5 archive. If unreachable it uses `data/storm/april_2024_doha_hourly_fallback.csv`, a
  hand-designed curve shaped after public reporting — **not an observation**. The header pill
  names the active source. See `data/storm/README.md` (including a calibration note).
* **Zones**: twelve simplified district polygons with plausible synthetic attributes.
* **Risk (Phase 1)**: `physics_v0`, a transparent mass balance
  (`surface += (rain × imperviousness − drainage) × dt; depth = surface × concentration`)
  with a documented weighted score. The zone card shows the driver breakdown. Phase 2 trains
  the XGBoost nowcast on labels from this same generator. This is decision support, not a
  hydrological model — and the UI says so.
* **Historical figures** in copy are approximate, based on public reports.

## Governance made visible

Every alert in the feed carries its rule id and version (`R-01 v1.0`), and every decision
writes a `decision_log` row with the exact inputs snapshot the rule saw. Phase 1 rules:

| Rule | Plain language |
|---|---|
| R-06 v1.0 | risk ≥ 40 → YELLOW watch |
| R-02 v1.0 | risk ≥ 60 → ORANGE warning |
| R-01 v1.0 | risk ≥ 80 for 2 consecutive intervals → RED alert + advisory draft |
| R-03 v1.0 | RED + underpass zone → action item: close underpass, divert traffic |
| R-07 v1.0 | active alert AND risk < 40 for 60 min → clear + stand-down message |

R-04 (forecast pre-positioning) and R-05 (agent plan validation) arrive with the forecast model
and the agent. The agent can only *propose*; the single path to changing asset state is
`rules.validate_and_apply(plan, operator_id)` after an operator clicks APPROVE.

## Repository

```
├─ CLAUDE.md                 the spec (read first)
├─ docker-compose.yml        Postgres 16 + PostGIS + pgvector (docker/postgres/Dockerfile)
├─ Makefile                  setup · db · schema · seed · train · dev · test · lint
├─ backend/                  FastAPI — sadd/{api,rules,sim,models,agent}, sql/, tests/
├─ frontend/                 Next.js 15 · TypeScript strict · Tailwind 4 · zustand · SWR · recharts
├─ flood-forecasting-mcp/    custom MCP server (Phase 3)
├─ data/                     geojson · storm curve · fleet · protocols EN/AR
└─ docs/screenshots/
```

## Build order

| Phase | Deliverable | Status |
|---|---|---|
| P1 | scaffold · schema + seed · 3D map with risk-coloured zones · KPI strip · alert feed · replay scrubber · live mode · rules R-01/02/03/06/07 · AR/EN RTL | **done** |
| P2 | trained models · server-driven replay engine · R-04 · reactive-2024 fleet animation | next |
| P3 | flood-forecasting-mcp · MCP Toolbox · Rafid (6 tools, streaming, citations, approval flow) | |
| P4 | Simulation Lab · Response & Governance · Executive · polish | |
| P5 | rehearsal fixes only | |

---
*Fictional operations center for demonstration. Uses Google APIs; not endorsed by or affiliated with Google or any government entity.*
