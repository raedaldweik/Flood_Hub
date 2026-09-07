"""Rafid's local tools (plain Python callables — ADK wraps them as FunctionTools).

Each docstring is the tool description the model sees, so it says exactly what the tool does and
what "now" means. The MCP Toolbox and flood-forecasting-mcp toolsets are wired in rafid.py.
"""

from __future__ import annotations

from ..db import query, query_one
from ..models import get_registry
from ..sim.physics import ZoneParams, band
from . import plans, rag
from .context import turn

ADVISORY_TEMPLATES = {
    "red": {
        "en": (
            "FLOOD ALERT — {zone}: streets and underpasses are flooding. Avoid travel, do not drive through "
            "water, move vehicles to high ground. Civil defence: 999. — Doha FOC"
        ),
        "ar": (
            "تنبيه فيضان — {zone}: الشوارع والأنفاق تغمرها المياه. تجنبوا التنقل، لا تقودوا عبر المياه، "
            "انقلوا المركبات إلى أماكن مرتفعة. الدفاع المدني: 999 — مركز عمليات الفيضانات"
        ),
    },
    "orange": {
        "en": (
            "FLOOD WARNING — {zone}: heavy rain expected to exceed drainage in the next hours. Delay "
            "non-essential travel; underpasses may close at short notice. — Doha FOC"
        ),
        "ar": (
            "تحذير فيضان — {zone}: أمطار غزيرة متوقعة تفوق قدرة الصرف خلال الساعات القادمة. أجّلوا التنقل "
            "غير الضروري؛ قد تُغلق الأنفاق دون إشعار مسبق — مركز عمليات الفيضانات"
        ),
    },
    "yellow": {
        "en": (
            "WEATHER ADVISORY — {zone}: heavy rain forecast. Clear drains near your property, secure loose "
            "items, keep children away from storm channels. — Doha FOC"
        ),
        "ar": (
            "إرشاد جوي — {zone}: أمطار غزيرة متوقعة. نظّفوا مصارف المياه قرب ممتلكاتكم، وثبّتوا الأغراض، "
            "وأبعدوا الأطفال عن قنوات تصريف الأمطار — مركز عمليات الفيضانات"
        ),
    },
}


def _tick(tick: int | None) -> int:
    return turn().tick if tick is None else int(tick)


def _zone_params(z: dict) -> ZoneParams:
    return ZoneParams(
        zone_id=z["id"],
        imperviousness_pct=z["imperviousness_pct"],
        drainage_capacity_mm_h=z["drainage_capacity_mm_per_h"],
        elevation_m=z["elevation_m"],
        has_underpass=z["has_underpass"],
        area_km2=z["area_km2"],
        population=z["population"],
        criticality=z["criticality"],
    )


# ── situational data (local fallback for the MCP Toolbox toolset; same names, same SQL) ──────────


def get_replay_context() -> dict:
    """The operator's current moment: replay tick, time, mode and language. Call this first when the
    question depends on 'now' (which zones are critical, what happened at a given time)."""
    m = query_one(
        "SELECT tick_minutes, n_ticks, peak_tick, start_ts, end_ts, risk_source FROM replay_meta WHERE id = 1"
    )
    t = turn()
    return {
        "current": t.as_dict(),
        "replay": m or {},
        "note": "ticks are 10 minutes; tick 0 = 15 April 2024 00:00 Doha",
    }


def get_zone_status(zone_id: str, tick: int | None = None) -> dict:
    """State of one zone at a replay tick (default: the operator's current time): rain, 3 h accumulation,
    hotspot depth, flooded flag, risk score + band, active alerts and pump trucks on site."""
    t = _tick(tick)
    row = query_one(
        "SELECT z.id, z.name_en, z.name_ar, z.population, z.has_underpass, z.drainage_capacity_mm_per_h, "
        "z.criticality, "
        "f.rain_mm_h, f.cum_3h_mm, f.exceedance_mm_h, f.water_depth_cm, f.flooded, f.risk_score, f.risk_source, f.ts "
        "FROM zones z JOIN flood_state f ON f.zone_id = z.id WHERE z.id = %s AND f.tick = %s",
        (zone_id, t),
    )
    if not row:
        return {"error": f"no state for zone '{zone_id}' at tick {t}"}
    alerts = query(
        "SELECT severity, type, rule_id, rule_version, message_en, message_ar, tick FROM alerts "
        "WHERE zone_id = %s AND tick <= %s AND (cleared_tick IS NULL OR cleared_tick > %s) ORDER BY tick DESC",
        (zone_id, t, t),
    )
    assets = query(
        "SELECT id, callsign, type, capacity_m3_h, status FROM assets WHERE zone_id = %s ORDER BY id", (zone_id,)
    )
    row["ts"] = row["ts"].isoformat()
    return {**row, "band": band(row["risk_score"]), "tick": t, "active_alerts": alerts, "assets_on_site": assets}


def list_zones_at_risk(tick: int | None = None, min_risk: float = 40.0) -> dict:
    """Zones at or above a risk score at a replay tick (default: now), highest first, with band and population."""
    t = _tick(tick)
    rows = query(
        "SELECT z.id, z.name_en, z.name_ar, z.population, z.has_underpass, f.risk_score, f.water_depth_cm, f.flooded, "
        "f.rain_mm_h FROM flood_state f JOIN zones z ON z.id = f.zone_id WHERE f.tick = %s AND f.risk_score >= %s "
        "ORDER BY f.risk_score DESC",
        (t, min_risk),
    )
    for r in rows:
        r["band"] = band(r["risk_score"])
    return {"tick": t, "min_risk": min_risk, "zones": rows, "count": len(rows)}


def get_active_alerts(tick: int | None = None) -> dict:
    """Alerts active at a replay tick (default: now): severity, type, zone, rule id/version, message."""
    t = _tick(tick)
    rows = query(
        "SELECT a.id, a.tick, a.zone_id, z.name_en, a.severity, a.type, a.rule_id, a.rule_version, a.message_en, "
        "a.message_ar FROM alerts a JOIN zones z ON z.id = a.zone_id "
        "WHERE a.tick <= %s AND (a.cleared_tick IS NULL OR a.cleared_tick > %s) ORDER BY a.tick DESC",
        (t, t),
    )
    return {"tick": t, "alerts": rows, "count": len(rows)}


def get_kpis(tick: int | None = None) -> dict:
    """Operational KPIs at a replay tick (default: now): active alerts, zones at risk, zones flooded,
    population affected, mean alert lead time in minutes."""
    t = _tick(tick)
    row = query_one("SELECT * FROM replay_kpis WHERE tick = %s", (t,))
    return row or {"error": f"no KPIs at tick {t}"}


def get_decision_log(limit: int = 12, zone_id: str = "", rule_id: str = "") -> dict:
    """Most recent decision-log entries (the governance ledger): rule id + version, inputs snapshot,
    output, proposer and approver. Optional filters by zone or rule."""
    sql = (
        "SELECT id, ts, tick, decision_type, zone_id, rule_id, rule_version, proposed_by, approved_by, notified, "
        "output_json FROM decision_log"
    )
    where, args = [], []
    if zone_id:
        where.append("zone_id = %s")
        args.append(zone_id)
    if rule_id:
        where.append("rule_id = %s")
        args.append(rule_id)
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY ts DESC, id DESC LIMIT %s"
    args.append(max(1, min(int(limit), 50)))
    rows = query(sql, args)
    for r in rows:
        r["ts"] = r["ts"].isoformat()
        r["message_en"] = (r.pop("output_json") or {}).get("message_en")
    return {"entries": rows, "count": len(rows)}


def get_assets(zone_id: str = "") -> dict:
    """The pump-truck and tanker fleet with status (idle / staged / enroute / pumping), depot and assigned zone.
    Filter by zone_id to see what is on site."""
    sql = (
        "SELECT a.id, a.callsign, a.type, a.capacity_m3_h, a.status, a.zone_id, d.name_en AS depot "
        "FROM assets a LEFT JOIN depots d ON d.id = a.depot_id"
    )
    args: list = []
    if zone_id:
        sql += " WHERE a.zone_id = %s"
        args.append(zone_id)
    sql += " ORDER BY a.type, a.id"
    rows = query(sql, args)
    return {
        "assets": rows,
        "count": len(rows),
        "pump_trucks_idle": sum(1 for r in rows if r["type"] == "pump_truck" and r["status"] == "idle"),
    }


# ── model, RAG, planning, drafting ───────────────────────────────────────────────────────────────


def score_zone(zone_id: str, rain_multiplier: float = 1.0) -> dict:
    """Score a zone with the XGBoost risk nowcast under the current replay rain scaled by rain_multiplier
    (2.0 = 'if rain doubles'). Returns risk 0-100, band and per-feature TreeSHAP contributions."""
    z = query_one("SELECT * FROM zones WHERE id = %s", (zone_id,))
    if not z:
        return {"error": f"unknown zone '{zone_id}'"}
    st = query_one(
        "SELECT rain_mm_h, cum_3h_mm, water_depth_cm FROM flood_state WHERE zone_id = %s AND tick = %s",
        (zone_id, turn().tick),
    )
    if not st:
        return {"error": f"no state for tick {turn().tick}"}
    p = _zone_params(z)
    rain, cum3 = st["rain_mm_h"] * rain_multiplier, st["cum_3h_mm"] * rain_multiplier
    out = get_registry().risk_contributions(p, rain, cum3, st["water_depth_cm"] * rain_multiplier)
    return {
        "zone_id": zone_id,
        "name_en": z["name_en"],
        "name_ar": z["name_ar"],
        "rain_multiplier": rain_multiplier,
        "inputs": {
            "rain_mm_h": round(rain, 1),
            "cum_3h_mm": round(cum3, 1),
            "drainage_capacity_mm_h": p.drainage_capacity_mm_h,
        },
        "risk": out["risk"],
        "band": band(out["risk"]),
        "source": out["source"],
        "contributions": out["contributions"],
    }


def search_protocols(query: str, lang: str = "") -> dict:
    """Search the FOC protocol corpus (underpass closure, pump deployment, sandbags, school advisories,
    hospital protection, SMS templates, evacuation ladder, drain inspection, substation/metro protection).
    Returns sections with doc_id and section_no to cite as [DOC-ID §n]. Fictional training documents."""
    return rag.search_protocols(query, lang or turn().lang, k=4)


def propose_dispatch_plan(
    objective: str = "minimise time-to-drain across flooded zones", storm_multiplier: float = 1.0
) -> dict:
    """Propose a pump-truck allocation plan for the operator to APPROVE. Uses the what-if engine: trucks in
    proportion to hotspot water volume × criticality, evaluated for expected time-to-drain and damage deltas.
    The plan is NOT executed; the operator approves it and rule R-05 validates and applies it."""
    return plans.propose(objective, storm_multiplier, turn().tick, turn().lang)


def draft_advisory(zone_id: str, severity: str = "red", lang: str = "") -> dict:
    """Draft a public SMS advisory (≤ 160 chars target) for a zone and severity in EN and AR from the FOC
    templates (FOC-TPL-06). Returned as DRAFT for operator review; Rafid never sends messages."""
    z = query_one("SELECT name_en, name_ar FROM zones WHERE id = %s", (zone_id,))
    if not z:
        return {"error": f"unknown zone '{zone_id}'"}
    sev = severity if severity in ADVISORY_TEMPLATES else "red"
    en = ADVISORY_TEMPLATES[sev]["en"].format(zone=z["name_en"])
    ar = ADVISORY_TEMPLATES[sev]["ar"].format(zone=z["name_ar"])
    return {
        "status": "DRAFT",
        "zone_id": zone_id,
        "severity": sev,
        "template": f"FOC-TPL-06 §{ {'red': 5, 'orange': 4, 'yellow': 3}[sev] }",
        "preferred_lang": lang or turn().lang,
        "sms_en": en,
        "sms_ar": ar,
        "chars_en": len(en),
        "chars_ar": len(ar),
        "note": "For operator review and release through the mass-notification system. Not sent.",
    }


LOCAL_DB_TOOLS = [
    get_replay_context,
    get_zone_status,
    list_zones_at_risk,
    get_active_alerts,
    get_kpis,
    get_decision_log,
    get_assets,
]
LOCAL_TOOLS = [score_zone, search_protocols, propose_dispatch_plan, draft_advisory]
