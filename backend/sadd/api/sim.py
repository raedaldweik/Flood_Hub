"""Stateless what-if for the Simulation Lab: POST a scenario, get per-zone outcomes + KPI deltas."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..db import query, query_one
from ..models import get_registry
from ..sim.physics import ZoneParams
from ..sim.whatif import Scenario, simulate
from .replay import get_meta

router = APIRouter(prefix="/api/sim", tags=["sim"])


class ScenarioIn(BaseModel):
    storm_multiplier: float = Field(1.0, ge=0.25, le=3.0, description="× the April-2024 rain")
    allocations: dict[str, int] = Field(default_factory=dict, description="zone_id → pump trucks on site")
    prepositioned: bool = Field(False, description="trucks staged before the rain (else a 6 h reactive delay)")
    drain_upgrade_pct: float = Field(0.0, ge=0.0, le=100.0, description="drainage capacity uplift")


_cache: dict = {}


def _inputs() -> dict:
    """Zones + per-zone tick rain from the seeded replay, cached until the replay is re-seeded."""
    m = get_meta()
    if not m:
        raise HTTPException(409, "replay not seeded")
    key = m.seeded_at.isoformat()
    if _cache.get("key") != key:
        zones = [
            ZoneParams(
                zone_id=z["id"],
                imperviousness_pct=z["imperviousness_pct"],
                drainage_capacity_mm_h=z["drainage_capacity_mm_per_h"],
                elevation_m=z["elevation_m"],
                has_underpass=z["has_underpass"],
                area_km2=z["area_km2"],
                population=z["population"],
                criticality=z["criticality"],
            )
            for z in query("SELECT * FROM zones ORDER BY id")
        ]
        rain: dict[str, list[float]] = {z.zone_id: [] for z in zones}
        for r in query("SELECT zone_id, rain_mm_h FROM flood_state ORDER BY zone_id, tick"):
            rain[r["zone_id"]].append(r["rain_mm_h"])
        fleet = query_one("SELECT count(*) AS n FROM assets WHERE type = 'pump_truck'")
        _cache.update(
            key=key,
            zones=zones,
            rain=rain,
            tick_minutes=m.tick_minutes,
            fleet=int(fleet["n"] if fleet else 24),
            baseline=None,
        )
    return _cache


def _baseline(inp: dict) -> dict:
    if inp["baseline"] is None:
        inp["baseline"] = simulate(Scenario(), inp["zones"], inp["rain"], inp["tick_minutes"], get_registry())["kpis"]
    return inp["baseline"]


@router.get("/baseline")
def baseline() -> dict:
    """April 2024 as it happened: no pumps, reactive posture, today's drains."""
    inp = _inputs()
    return simulate(Scenario(), inp["zones"], inp["rain"], inp["tick_minutes"], get_registry(), baseline=_baseline(inp))


@router.post("/simulate")
def run_scenario(scen: ScenarioIn) -> dict:
    inp = _inputs()
    known = {z.zone_id for z in inp["zones"]}
    unknown = sorted(set(scen.allocations) - known)
    if unknown:
        raise HTTPException(422, f"unknown zone(s): {', '.join(unknown)}")
    if any(v < 0 for v in scen.allocations.values()):
        raise HTTPException(422, "allocations must be ≥ 0")
    if sum(scen.allocations.values()) > inp["fleet"]:
        raise HTTPException(422, f"allocations exceed the pump fleet ({inp['fleet']} trucks)")
    s = Scenario(scen.storm_multiplier, dict(scen.allocations), scen.prepositioned, scen.drain_upgrade_pct)
    out = simulate(s, inp["zones"], inp["rain"], inp["tick_minutes"], get_registry(), baseline=_baseline(inp))
    out["fleet_size"] = inp["fleet"]
    return out
