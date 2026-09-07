"""Dispatch plan proposals: a transparent greedy optimiser over the what-if engine, plus the in-memory
ledger of proposals awaiting an operator's APPROVE (applied only through rules.dispatch)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from ..api.sim import _baseline, _inputs
from ..models import get_registry
from ..models.features import hotspot_volume_m3
from ..sim.physics import BAND_YELLOW, ZoneParams
from ..sim.whatif import Scenario, simulate

MAX_PER_ZONE = 6
PLANS: dict[str, dict] = {}


def greedy_allocation(base_zones: list[dict], zones: list[ZoneParams], fleet: int) -> dict[str, int]:
    """Trucks in proportion to hotspot water volume × criticality, at least one per flooded zone, at most
    MAX_PER_ZONE per zone, never more than the fleet. Pure and deterministic — the same call feeds Rafid's
    proposals and the Executive View's "with SADD" comparison."""
    by_zone = {z.zone_id: z for z in zones}
    candidates = [o for o in base_zones if o["peak_risk"] >= BAND_YELLOW and o["peak_depth_cm"] > 0]
    weights = {
        o["zone_id"]: hotspot_volume_m3(by_zone[o["zone_id"]], o["peak_depth_cm"]) * by_zone[o["zone_id"]].criticality
        for o in candidates
    }
    alloc: dict[str, int] = {}
    if not weights:
        return alloc
    for o in candidates:  # one truck for every zone that actually floods
        if o["flooded_h"] > 0:
            alloc[o["zone_id"]] = 1
    remaining = fleet - sum(alloc.values())
    total_w = sum(weights.values())
    for zid, w in sorted(weights.items(), key=lambda kv: -kv[1]):
        share = round(remaining * w / total_w) if total_w else 0
        alloc[zid] = min(MAX_PER_ZONE, alloc.get(zid, 0) + share)
    while sum(alloc.values()) > fleet:  # rounding can overshoot by a truck or two
        top = max(alloc, key=lambda k: alloc[k])
        alloc[top] -= 1
    return {k: v for k, v in alloc.items() if v > 0}


def propose(objective: str, storm_multiplier: float, tick: int | None, lang: str) -> dict:
    """Greedy: trucks in proportion to hotspot water volume × criticality, at least one per flooded zone.

    Every proposal is evaluated with the same what-if engine the Simulation Lab uses, so the expected
    time-to-drain and damage deltas are the numbers the operator will see after approval.
    """
    inp = _inputs()
    registry = get_registry()
    zones, rain, dt, fleet = inp["zones"], inp["rain"], inp["tick_minutes"], inp["fleet"]
    base = simulate(Scenario(storm_multiplier=storm_multiplier), zones, rain, dt, registry, baseline=_baseline(inp))
    alloc = greedy_allocation(base["zones"], zones, fleet)
    scen = Scenario(storm_multiplier=storm_multiplier, allocations=alloc, prepositioned=True)
    out = simulate(scen, zones, rain, dt, registry, baseline=base["kpis"])
    names = {z.zone_id: z for z in zones}
    plan = {
        "plan_id": uuid.uuid4().hex[:8],
        "created_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "status": "proposed",
        "objective": objective,
        "tick": tick,
        "storm_multiplier": storm_multiplier,
        "prepositioned": True,
        "fleet_size": fleet,
        "allocations": alloc,
        "zones": [
            {
                "zone_id": o["zone_id"],
                "pumps": o["pumps"],
                "peak_band": o["peak_band"],
                "time_to_drain_h": o["time_to_drain_h"],
                "flooded_h": o["flooded_h"],
                "baseline_time_to_drain_h": next(
                    b["time_to_drain_h"] for b in base["zones"] if b["zone_id"] == o["zone_id"]
                ),
                "population": names[o["zone_id"]].population,
            }
            for o in out["zones"]
            if o["pumps"] > 0
        ],
        "expected": out["kpis"],
        "baseline": base["kpis"],
        "delta": out["delta"],
        "rule": "R-05 v1.0 validates this plan when an operator approves it",
        "lang": lang,
    }
    PLANS[plan["plan_id"]] = plan
    return plan


def get(plan_id: str) -> dict | None:
    return PLANS.get(plan_id)


def mark(plan_id: str, status: str, result: dict | None = None) -> None:
    if plan_id in PLANS:
        PLANS[plan_id]["status"] = status
        if result is not None:
            PLANS[plan_id]["result"] = result
