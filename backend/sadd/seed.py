"""`make seed` — load reference data and precompute the April-2024 replay.

Steps (idempotent: wipes and reloads the demo tables):
  1. zones            ← data/geojson/doha_zones.geojson (PostGIS computes area)
  2. rain             ← Open-Meteo historical archive (ERA5) or bundled fallback CSV
  3. rain_readings    ← hourly per-zone series (spatial factor × smooth noise)
  4. replay_ticks + flood_state ← physics_v0 mass balance at N-minute ticks
  5. alerts + decision_log      ← rules engine over the timeline (the ONLY writer)
  6. replay_kpis      ← per-tick KPI series for the Command Center strip
  7. depots + assets  ← data/seeds/assets.json
  8. protocol_chunks  ← data/protocols/{en,ar}/*.md split by numbered section
  9. gauges           ← one virtual gauge per zone (backing the flood MCP in Phase 3)
"""

from __future__ import annotations

import csv
import json
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import psycopg
from psycopg.types.json import Jsonb

from .config import DATA_DIR, get_settings
from .rules import evaluate_timeline
from .sim import RISK_SOURCE, ZoneParams, build_timeline, distribute_rain, interpolate_ticks
from .sim.replay import TickState

QATAR = ZoneInfo("Asia/Qatar")
OPEN_METEO_ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"


def log(msg: str) -> None:
    print(f"[seed] {msg}", flush=True)


# ── 1. zones ─────────────────────────────────────────────────────────────────
def load_zones(conn: psycopg.Connection) -> list[dict]:
    geo = json.loads((DATA_DIR / "geojson" / "doha_zones.geojson").read_text(encoding="utf-8"))
    with conn.cursor() as cur:
        for f in geo["features"]:
            p = f["properties"]
            cur.execute(
                """
                INSERT INTO zones (id, name_en, name_ar, geom, area_km2, elevation_m, imperviousness_pct,
                                   drainage_capacity_mm_per_h, population, has_underpass, criticality,
                                   rain_factor, notes)
                VALUES (%(id)s, %(name_en)s, %(name_ar)s,
                        ST_SetSRID(ST_GeomFromGeoJSON(%(geom)s), 4326),
                        ST_Area(ST_SetSRID(ST_GeomFromGeoJSON(%(geom)s), 4326)::geography) / 1e6,
                        %(elevation_m)s, %(imperviousness_pct)s, %(drainage)s, %(population)s,
                        %(has_underpass)s, %(criticality)s, %(rain_factor)s, %(notes)s)
                """,
                {
                    "id": p["id"], "name_en": p["name_en"], "name_ar": p["name_ar"],
                    "geom": json.dumps(f["geometry"]), "elevation_m": p["elevation_m"],
                    "imperviousness_pct": p["imperviousness_pct"],
                    "drainage": p["drainage_capacity_mm_per_h"], "population": p["population"],
                    "has_underpass": p["has_underpass"], "criticality": p["criticality"],
                    "rain_factor": p.get("rain_factor", 1.0), "notes": p.get("notes"),
                },
            )
        cur.execute("SELECT * FROM zones ORDER BY id")
        rows = cur.fetchall()
    log(f"zones: {len(rows)} loaded")
    return rows


# ── 2. city rainfall ─────────────────────────────────────────────────────────
def fetch_open_meteo(start: date, end: date, lat: float, lng: float) -> list[tuple[datetime, float]] | None:
    try:
        r = httpx.get(
            OPEN_METEO_ARCHIVE,
            params={
                "latitude": lat, "longitude": lng,
                "start_date": start.isoformat(), "end_date": end.isoformat(),
                "hourly": "precipitation", "timezone": "Asia/Qatar",
            },
            timeout=20,
        )
        r.raise_for_status()
        data = r.json()["hourly"]
        series = [
            (datetime.fromisoformat(t).replace(tzinfo=QATAR), float(v or 0.0))
            for t, v in zip(data["time"], data["precipitation"], strict=True)
        ]
        if not series or all(v == 0 for _, v in series):
            log("open-meteo returned an empty/zero series — using fallback")
            return None
        return series
    except Exception as exc:  # network, proxy, schema — any failure means fallback
        log(f"open-meteo unavailable ({type(exc).__name__}: {exc}) — using fallback CSV")
        return None


def load_fallback_csv() -> list[tuple[datetime, float]]:
    path = DATA_DIR / "storm" / "april_2024_doha_hourly_fallback.csv"
    with path.open(encoding="utf-8") as f:
        return [
            (datetime.fromisoformat(row["ts"]), float(row["precipitation_mm"])) for row in csv.DictReader(f)
        ]


def get_city_rain() -> tuple[list[tuple[datetime, float]], str]:
    s = get_settings()
    if not s.seed_force_fallback:
        series = fetch_open_meteo(
            date.fromisoformat(s.replay_start_date), date.fromisoformat(s.replay_end_date),
            s.open_meteo_lat, s.open_meteo_lng,
        )
        if series:
            log(f"rain: open-meteo archive, {len(series)} hourly rows, total {sum(v for _, v in series):.1f} mm")
            return series, "open-meteo-archive"
    series = load_fallback_csv()
    log(f"rain: fallback CSV, {len(series)} hourly rows, total {sum(v for _, v in series):.1f} mm")
    return series, "fallback-csv"


# ── 3–6. replay precompute ───────────────────────────────────────────────────
def zone_params(z: dict) -> ZoneParams:
    return ZoneParams(
        zone_id=z["id"], imperviousness_pct=z["imperviousness_pct"],
        drainage_capacity_mm_h=z["drainage_capacity_mm_per_h"], elevation_m=z["elevation_m"],
        has_underpass=z["has_underpass"], area_km2=z["area_km2"], population=z["population"],
        criticality=z["criticality"],
    )


def precompute_replay(
    conn: psycopg.Connection, zones: list[dict], city: list[tuple[datetime, float]], rain_source: str
) -> None:
    s = get_settings()
    tick_min = s.replay_tick_minutes
    start_ts = city[0][0]
    hourly = [v for _, v in city]
    per_zone_hourly = distribute_rain(hourly, {z["id"]: z["rain_factor"] for z in zones})
    params = [zone_params(z) for z in zones]
    zone_tick_rain = {zid: interpolate_ticks(series, tick_min) for zid, series in per_zone_hourly.items()}
    states = build_timeline(start_ts, tick_min, params, zone_tick_rain)
    n_ticks = len(zone_tick_rain[zones[0]["id"]])
    city_ticks = interpolate_ticks(hourly, tick_min)

    with conn.cursor() as cur:
        # hourly rain_readings (the observation table; cumulative per zone)
        rows = []
        for zid, series in per_zone_hourly.items():
            cum = 0.0
            for (ts, _), v in zip(city, series, strict=True):
                cum += v
                rows.append((ts, zid, v, round(cum, 3), "replay_2024"))
        cur.executemany(
            "INSERT INTO rain_readings (ts, zone_id, intensity_mm_h, cumulative_mm, source) VALUES (%s,%s,%s,%s,%s)",
            rows,
        )
        cur.executemany(
            "INSERT INTO replay_ticks (tick, ts, city_rain_mm_h) VALUES (%s,%s,%s)",
            [(i, start_ts + timedelta(minutes=i * tick_min), city_ticks[i]) for i in range(n_ticks)],
        )
        cur.executemany(
            """INSERT INTO flood_state (tick, ts, zone_id, rain_mm_h, cum_3h_mm, exceedance_mm_h,
                                        water_depth_cm, flooded, risk_score, risk_source)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            [
                (st.tick, st.ts, st.zone_id, st.rain_mm_h, st.cum_3h_mm, st.exceedance_mm_h,
                 st.depth_cm, st.flooded, st.risk, RISK_SOURCE)
                for st in states
            ],
        )
        peak_tick = max(range(n_ticks), key=lambda i: city_ticks[i])
        cur.execute(
            """INSERT INTO replay_meta
                 (id, start_ts, end_ts, tick_minutes, n_ticks, peak_tick, rain_source, risk_source)
               VALUES (1, %s, %s, %s, %s, %s, %s, %s)""",
            (start_ts, start_ts + timedelta(minutes=(n_ticks - 1) * tick_min), tick_min, n_ticks, peak_tick,
             rain_source, RISK_SOURCE),
        )
    log(f"replay: {n_ticks} ticks × {len(zones)} zones = {len(states)} states (peak tick {peak_tick})")

    # 5. rules engine → alerts + decision_log
    meta = {
        z["id"]: {
            "name_en": z["name_en"], "name_ar": z["name_ar"], "has_underpass": z["has_underpass"],
            "drainage_capacity_mm_h": z["drainage_capacity_mm_per_h"],
        }
        for z in zones
    }
    out = evaluate_timeline(states, meta)
    with conn.cursor() as cur:
        cur.executemany(
            """INSERT INTO alerts (ts, tick, zone_id, severity, type, message_en, message_ar, rule_id, rule_version,
                                   status, cleared_ts, cleared_tick, source)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'replay_2024')""",
            [
                (a.ts, a.tick, a.zone_id, a.severity, a.alert_type, a.message_en, a.message_ar, a.rule_id,
                 a.rule_version, a.status, a.cleared_ts, a.cleared_tick)
                for a in out.alerts
            ],
        )
        cur.executemany(
            """INSERT INTO decision_log (ts, tick, decision_type, zone_id, rule_id, rule_version, inputs_json,
                                         output_json, proposed_by, approved_by, notified, source)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'replay_2024')""",
            [
                (d.ts, d.tick, d.decision_type, d.zone_id, d.rule_id, d.rule_version, Jsonb(d.inputs),
                 Jsonb(d.output), d.proposed_by, d.approved_by, d.notified)
                for d in out.decisions
            ],
        )
    by_sev = {
        s: sum(1 for a in out.alerts if a.severity == s and a.alert_type == "zone_risk")
        for s in ("yellow", "orange", "red")
    }
    log(f"rules: {len(out.alerts)} alerts ({by_sev}), {len(out.decisions)} decision-log rows")

    # 6. KPI series
    kpis = compute_kpis(states, out.alerts, zones, n_ticks)
    with conn.cursor() as cur:
        cur.executemany(
            """INSERT INTO replay_kpis (tick, active_alerts, zones_at_risk, zones_flooded, assets_deployed,
                                        population_affected, lead_time_min)
               VALUES (%s,%s,%s,%s,%s,%s,%s)""",
            kpis,
        )
    log(f"kpis: {len(kpis)} ticks; max zones at risk {max(k[2] for k in kpis)}, max flooded {max(k[3] for k in kpis)}")


def compute_kpis(states: list[TickState], alerts, zones: list[dict], n_ticks: int) -> list[tuple]:
    pop = {z["id"]: z["population"] for z in zones}
    by_tick: dict[int, list[TickState]] = {}
    for st in states:
        by_tick.setdefault(st.tick, []).append(st)
    first_alert: dict[str, int] = {}
    for a in sorted(alerts, key=lambda a: a.tick):
        if a.alert_type == "zone_risk" and a.severity in ("orange", "red"):
            first_alert.setdefault(a.zone_id, a.tick)
    first_flood: dict[str, int] = {}
    for st in sorted(states, key=lambda s: s.tick):
        if st.flooded:
            first_flood.setdefault(st.zone_id, st.tick)
    tick_min = get_settings().replay_tick_minutes

    rows = []
    for t in range(n_ticks):
        zs = by_tick.get(t, [])
        at_risk = [z for z in zs if z.risk >= 60]
        active = sum(1 for a in alerts if a.tick <= t and (a.cleared_tick is None or a.cleared_tick > t))
        leads = [
            (first_flood[z] - first_alert[z]) * tick_min
            for z in first_flood
            if first_flood[z] <= t and z in first_alert and first_alert[z] <= first_flood[z]
        ]
        rows.append((
            t, active, len(at_risk), sum(1 for z in zs if z.flooded), 0,  # assets_deployed animates in Phase 2
            sum(pop[z.zone_id] for z in at_risk),
            round(sum(leads) / len(leads), 1) if leads else None,
        ))
    return rows


# ── 7. fleet ─────────────────────────────────────────────────────────────────
def load_assets(conn: psycopg.Connection) -> None:
    data = json.loads((DATA_DIR / "seeds" / "assets.json").read_text(encoding="utf-8"))
    depots = {d["id"]: d for d in data["depots"]}
    prefix = data["callsign_prefix"]
    with conn.cursor() as cur:
        cur.executemany(
            "INSERT INTO depots (id, name_en, name_ar, lat, lng) VALUES (%s,%s,%s,%s,%s)",
            [(d["id"], d["name_en"], d["name_ar"], d["lat"], d["lng"]) for d in data["depots"]],
        )
        rows = []
        per_depot_count: dict[str, int] = {}
        for a in data["fleet"]:
            d = depots[a["depot"]]
            n = per_depot_count.get(a["depot"], 0)
            per_depot_count[a["depot"]] = n + 1
            # Fan units out around the depot so markers don't stack on one pixel.
            lat = d["lat"] + ((n % 4) - 1.5) * 0.0009
            lng = d["lng"] + ((n // 4) - 1.0) * 0.0011
            num = a["id"].split("-")[1]
            rows.append((
                a["id"], f"{prefix[a['type']]['en']}-{num}", f"{prefix[a['type']]['ar']}-{num}", a["type"],
                a["capacity_m3_h"], round(lat, 6), round(lng, 6), a["depot"], None, "idle",
            ))
        cur.executemany(
            """INSERT INTO assets (id, callsign, callsign_ar, type, capacity_m3_h, lat, lng, depot_id, zone_id, status)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            rows,
        )
    log(f"assets: {len(rows)} units at {len(depots)} depots")


# ── 8. protocol corpus ───────────────────────────────────────────────────────
FRONT_MATTER = re.compile(r"^---\n(.*?)\n---\n", re.S)
SECTION = re.compile(r"^## (\d+)\.\s+(.*)$", re.M)


def chunk_document(text: str) -> tuple[dict, list[tuple[str, str, str]]]:
    fm_match = FRONT_MATTER.match(text)
    meta = dict(line.split(":", 1) for line in fm_match.group(1).splitlines()) if fm_match else {}
    meta = {k.strip(): v.strip() for k, v in meta.items()}
    body = text[fm_match.end():] if fm_match else text
    body = body.split("\n---\n")[0]  # drop the fictional-document footer
    chunks = []
    matches = list(SECTION.finditer(body))
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(body)
        content = body[m.start():end].strip()
        chunks.append((m.group(1), m.group(2).strip(), content))
    return meta, chunks


def load_protocols(conn: psycopg.Connection) -> None:
    rows = []
    for lang in ("en", "ar"):
        for path in sorted((DATA_DIR / "protocols" / lang).glob("*.md")):
            meta, chunks = chunk_document(path.read_text(encoding="utf-8"))
            for no, title, content in chunks:
                rows.append((meta["doc_id"], meta["title"], meta.get("version", "1.0"), title, no, lang, content))
    with conn.cursor() as cur:
        cur.executemany(
            """INSERT INTO protocol_chunks (doc_id, doc_title, doc_version, section, section_no, lang, content)
               VALUES (%s,%s,%s,%s,%s,%s,%s)""",
            rows,
        )
    log(f"protocols: {len(rows)} section chunks (embeddings in Phase 3)")


# ── 9. virtual gauges ────────────────────────────────────────────────────────
def load_gauges(conn: psycopg.Connection, zones: list[dict]) -> None:
    with conn.cursor() as cur:
        cur.execute("SELECT id, name_en, ST_Y(ST_Centroid(geom)) AS lat, ST_X(ST_Centroid(geom)) AS lng FROM zones")
        rows = cur.fetchall()
        cur.executemany(
            "INSERT INTO gauges (id, name, lat, lng, type, zone_id) VALUES (%s,%s,%s,%s,'virtual',%s)",
            [(f"DOHA-{r['id'].upper()}", f"{r['name_en']} virtual gauge", r["lat"], r["lng"], r["id"]) for r in rows],
        )
    log(f"gauges: {len(rows)} virtual gauges")


# ── main ─────────────────────────────────────────────────────────────────────
TABLES_IN_DELETE_ORDER = [
    "gauge_forecasts", "gauges", "protocol_chunks", "replay_kpis", "decision_log", "alerts",
    "assets", "depots", "flood_state", "replay_ticks", "replay_meta", "rain_readings", "zones",
]


def run() -> None:
    s = get_settings()
    log(f"database: {s.database_url.split('@')[-1]}")
    schema_dir = Path(__file__).resolve().parents[1] / "sql"
    with psycopg.connect(s.database_url, row_factory=psycopg.rows.dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute((schema_dir / "00_extensions.sql").read_text())
            cur.execute((schema_dir / "01_schema.sql").read_text())
            for t in TABLES_IN_DELETE_ORDER:
                cur.execute(f"DELETE FROM {t}")
        zones = load_zones(conn)
        city, rain_source = get_city_rain()
        precompute_replay(conn, zones, city, rain_source)
        load_assets(conn)
        load_protocols(conn)
        load_gauges(conn, zones)
        conn.commit()
    log("done")


if __name__ == "__main__":
    try:
        run()
    except psycopg.OperationalError as exc:
        print(
            f"[seed] cannot connect to Postgres: {exc}\n       start it with `make db` and check DATABASE_URL",
            file=sys.stderr,
        )
        sys.exit(1)
