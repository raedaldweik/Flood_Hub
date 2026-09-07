"""Executive View (Tab 4): the §1 KPIs as a modelled "April 2024 as it happened" vs "with SADD" comparison.

Both sides run through the same what-if engine with the SAME fleet and the SAME greedy allocation Rafid
proposes; the only difference is posture — reactive (trucks roll 6 h after the street floods, the 2018/2024
reality) versus prepared (trucks staged on the R-04 forecast recommendation). Alert lead time and the
population protected come from the rules ledger over the replay. Damage constants are illustrative and
labelled as such; this is decision-support arithmetic, not a hydrological model (CLAUDE.md §10).

GCP version: Looker Studio embed over the same BigQuery tables — this endpoint is the draft-1 stand-in.
"""

from __future__ import annotations

from statistics import median

from fastapi import APIRouter, Query

from ..agent.plans import greedy_allocation
from ..agent.summary import executive_summary
from ..db import query, query_one
from ..models import get_registry
from ..sim.whatif import REACTIVE_DEPLOY_DELAY_H, Scenario, simulate
from .sim import _baseline, _inputs

router = APIRouter(prefix="/api/executive", tags=["executive"])

_cache: dict = {}


def _closure_h(out: dict) -> float:
    return round(sum(z["flooded_h"] for z in out["zones"] if z["has_underpass"]), 1)


def _lead_times(tick_minutes: int) -> dict:
    """Per zone: first rule-fired alert → first flooded tick, and the R-04 recommendation → first flooded tick."""
    first_flood = {
        r["zone_id"]: r["t"]
        for r in query("SELECT zone_id, min(tick) AS t FROM flood_state WHERE flooded GROUP BY zone_id")
    }
    first_alert = {
        r["zone_id"]: r["t"]
        for r in query(
            "SELECT zone_id, min(tick) AS t FROM alerts WHERE source = 'replay_2024' AND type = 'zone_risk' "
            "GROUP BY zone_id"
        )
    }
    first_rec = {
        r["zone_id"]: r["t"]
        for r in query(
            "SELECT zone_id, min(tick) AS t FROM decision_log WHERE rule_id = 'R-04' AND source = 'replay_2024' "
            "GROUP BY zone_id"
        )
    }
    pops = {r["id"]: r["population"] for r in query("SELECT id, population FROM zones")}
    alert_lead = [(first_flood[z] - t) * tick_minutes for z, t in first_alert.items() if z in first_flood]
    rec_lead = [(first_flood[z] - t) * tick_minutes for z, t in first_rec.items() if z in first_flood]
    protected = {z for z, t in first_alert.items() if z in first_flood and t < first_flood[z]}
    protected |= {z for z, t in first_rec.items() if z in first_flood and t < first_flood[z]}
    return {
        "alert_lead_time_min": round(median(alert_lead), 1) if alert_lead else 0.0,
        "preposition_lead_time_min": round(median(rec_lead), 1) if rec_lead else 0.0,
        "zones_flooded": len(first_flood),
        "zones_warned_before_flooding": len(protected),
        "population_protected": sum(pops.get(z, 0) for z in protected),
        "population_flooded_zones": sum(pops.get(z, 0) for z in first_flood),
    }


@router.get("")
def report(lang: str = Query("en", pattern="^(en|ar)$")) -> dict:
    inp = _inputs()
    registry = get_registry()
    zones, rain, dt_min, fleet = inp["zones"], inp["rain"], inp["tick_minutes"], inp["fleet"]

    n_decisions = query_one("SELECT count(*) AS n FROM decision_log")["n"]
    fleet_rows = query("SELECT type, status, count(*) AS n FROM assets GROUP BY type, status")
    key = (inp["key"], n_decisions, tuple(sorted((r["type"], r["status"], r["n"]) for r in fleet_rows)))
    if _cache.get("key") == key and lang in _cache.get("reports", {}):
        return _cache["reports"][lang]

    no_pumps = _baseline(inp)
    base = simulate(Scenario(), zones, rain, dt_min, registry, baseline=no_pumps)
    alloc = greedy_allocation(base["zones"], zones, fleet)
    reactive = simulate(Scenario(allocations=alloc, prepositioned=False), zones, rain, dt_min, registry, no_pumps)
    prepared = simulate(Scenario(allocations=alloc, prepositioned=True), zones, rain, dt_min, registry, no_pumps)
    lead = _lead_times(dt_min)

    trucks_deployed = sum(alloc.values())
    live_fleet = {(r["type"], r["status"]): r["n"] for r in fleet_rows}
    pump_total = sum(n for (t, _), n in live_fleet.items() if t == "pump_truck") or fleet
    pump_active = sum(n for (t, s), n in live_fleet.items() if t == "pump_truck" and s != "idle")

    alerts_by_sev = {
        r["severity"]: r["n"]
        for r in query("SELECT severity, count(*) AS n FROM alerts WHERE source = 'replay_2024' GROUP BY severity")
    }
    zones_alerted = query_one("SELECT count(DISTINCT zone_id) AS n FROM alerts WHERE source = 'replay_2024'")["n"]
    by_rule = {r["rule_id"]: r["n"] for r in query("SELECT rule_id, count(*) AS n FROM decision_log GROUP BY rule_id")}
    by_proposer = {
        r["proposed_by"]: r["n"]
        for r in query("SELECT proposed_by, count(*) AS n FROM decision_log GROUP BY proposed_by")
    }
    approved = query_one("SELECT count(*) AS n FROM decision_log WHERE approved_by IS NOT NULL")["n"]
    trend = query(
        "SELECT t.tick, t.ts, t.city_rain_mm_h, k.active_alerts, k.zones_at_risk, k.zones_flooded "
        "FROM replay_kpis k JOIN replay_ticks t ON t.tick = k.tick WHERE k.tick % 3 = 0 ORDER BY k.tick"
    )
    meta = query_one("SELECT start_ts, end_ts, peak_tick, rain_source, tick_minutes FROM replay_meta WHERE id = 1")
    peak = query_one("SELECT ts FROM replay_ticks WHERE tick = %s", (meta["peak_tick"],)) if meta else None
    rain_total = query_one("SELECT sum(city_rain_mm_h) * %s / 60.0 AS mm FROM replay_ticks", (dt_min,))["mm"]

    actual_k, sadd_k = reactive["kpis"], prepared["kpis"]
    avoided = actual_k["damage_qar"] - sadd_k["damage_qar"]
    facts = {
        "alerts_total": sum(alerts_by_sev.values()),
        "zones_alerted": zones_alerted,
        "alert_lead_time_min": lead["alert_lead_time_min"],
        "all_clear_h_actual": actual_k["all_clear_h"],
        "all_clear_h_sadd": sadd_k["all_clear_h"],
        "avoided_damage_qar": avoided,
        "population_protected": lead["population_protected"],
    }
    reports = {}
    for lg in ("en", "ar"):
        reports[lg] = {
            "event": {
                "start_ts": meta["start_ts"] if meta else None,
                "end_ts": meta["end_ts"] if meta else None,
                "peak_ts": peak["ts"] if peak else None,
                "rain_source": meta["rain_source"] if meta else None,
                "city_rain_total_mm": round(float(rain_total or 0), 1),
            },
            "scorecards": {
                "alert_lead_time_min": {"actual": 0.0, "sadd": lead["alert_lead_time_min"]},
                "preposition_lead_time_min": {"actual": 0.0, "sadd": lead["preposition_lead_time_min"]},
                "time_to_drain_h": {"actual": actual_k["all_clear_h"], "sadd": sadd_k["all_clear_h"]},
                "population_protected": {"actual": 0, "sadd": lead["population_protected"]},
                "road_closure_h": {
                    "actual": _closure_h(reactive),
                    "sadd": _closure_h(prepared),
                    "km_affected": actual_k["roads_closed_km"],
                },
                "avoided_damage_qar": {"actual": 0, "sadd": avoided},
                "asset_utilisation_pct": {
                    "actual": round(100.0 * trucks_deployed / fleet, 1) if fleet else 0.0,
                    "sadd": round(100.0 * trucks_deployed / fleet, 1) if fleet else 0.0,
                    "live": round(100.0 * pump_active / pump_total, 1) if pump_total else 0.0,
                },
            },
            "comparison": [
                {"key": "damage_qar", "actual": actual_k["damage_qar"], "sadd": sadd_k["damage_qar"]},
                {"key": "road_closure_h", "actual": _closure_h(reactive), "sadd": _closure_h(prepared)},
                {
                    "key": "alert_lead_time_h",
                    "actual": 0.0,
                    "sadd": round(lead["alert_lead_time_min"] / 60.0, 1),
                },
                {"key": "all_clear_h", "actual": actual_k["all_clear_h"], "sadd": sadd_k["all_clear_h"]},
                {"key": "zones_flooded", "actual": actual_k["zones_flooded"], "sadd": sadd_k["zones_flooded"]},
                {"key": "total_flooded_h", "actual": actual_k["total_flooded_h"], "sadd": sadd_k["total_flooded_h"]},
            ],
            "scenarios": {
                "no_pumps": no_pumps,
                "reactive": actual_k,
                "prepared": sadd_k,
                "allocations": alloc,
                "fleet_size": fleet,
                "reactive_delay_h": REACTIVE_DEPLOY_DELAY_H,
                "sources": prepared["sources"],
            },
            "lead": lead,
            "trend": trend,
            "alerts": {
                "total": sum(alerts_by_sev.values()),
                "by_severity": alerts_by_sev,
                "zones_alerted": zones_alerted,
            },
            "decisions": {
                "total": n_decisions,
                "by_rule": by_rule,
                "by_proposer": by_proposer,
                "operator_approved": approved,
            },
            "fleet": {
                "pump_trucks": pump_total,
                "pump_trucks_active": pump_active,
                "utilisation_pct": round(100.0 * pump_active / pump_total, 1) if pump_total else 0.0,
                "by_status": {f"{t}:{s}": n for (t, s), n in live_fleet.items()},
            },
            "summary": executive_summary(facts, lg, cache_key=key),
            "assumptions": {
                "actual": (
                    "Modelled 'as it happened': same fleet and allocation, dispatched reactively "
                    f"{REACTIVE_DEPLOY_DELAY_H:.0f} h after each zone floods; no zone-level forecast alerts "
                    "(lead time 0). Approx., based on public reports of the 2018 and 2024 events."
                ),
                "sadd": (
                    "Same fleet staged on the R-04 forecast recommendation (6 h horizon) and rule-fired alerts "
                    "ahead of flooding. Alert lead time is the median over flooded zones in the replay."
                ),
                "damage": prepared["assumptions"]["note"],
                "damage_constants": {
                    k: prepared["assumptions"][k]
                    for k in ("damage_qar_per_person_flood_h", "underpass_closure_qar_per_h", "pump_truck_m3_h")
                },
                "gcp": "GCP version: Looker Studio embed over BigQuery.",
            },
        }
    _cache.update(key=key, reports=reports)
    return reports[lang]
