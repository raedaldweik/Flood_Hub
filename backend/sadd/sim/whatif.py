"""What-if engine behind the Simulation Lab (CLAUDE.md §10): stateless, well under 300 ms.

Inputs: storm multiplier (0.25–3× the April-2024 rain), pump trucks per zone, the two
preparedness toggles. Output: per-zone peak risk / depth / flooded hours / time-to-drain and the
KPI deltas against the untouched baseline.

The mass balance is the same physics_v0 step used by the replay, plus one honest extension:
pumps act at the hotspot where water collects (the basin sizes in models/features.py), so a
truck matters at an underpass and barely registers on a zone average — which is how it is in
the field. Risk comes from the XGBoost nowcast, time-to-drain from the gradient-boosted model,
both falling back to their transparent formulas when the artifacts are missing.
Damage figures are illustrative constants, labelled as such in the response.
"""

from __future__ import annotations

import time
from dataclasses import asdict, dataclass, field, replace

import numpy as np

from ..models.features import hotspot_basin_m2, hotspot_drainage_m3_h, hotspot_volume_m3, risk_features
from ..models.serve import Registry
from . import physics
from .physics import ZoneParams, ZoneState

PUMP_TRUCK_M3_H = 250.0  # fleet average; data/seeds/assets.json ranges 200–400
REACTIVE_DEPLOY_DELAY_H = 6.0  # 2018/2024 reality: trucks roll after the street is already under water
DAMAGE_QAR_PER_PERSON_FLOOD_H = 12.0  # illustrative
UNDERPASS_CLOSURE_QAR_PER_H = 40_000.0  # illustrative
ROAD_KM_PER_UNDERPASS_ZONE = 4.0  # key roads that close with the underpass


@dataclass(frozen=True)
class Scenario:
    storm_multiplier: float = 1.0
    allocations: dict[str, int] = field(default_factory=dict)  # zone_id → pump trucks on site
    prepositioned: bool = False  # trucks staged before the rain (0 h delay) vs reactive (6 h)
    drain_upgrade_pct: float = 0.0  # infrastructure what-if: drainage capacity × (1 + pct/100)


@dataclass
class ZoneOutcome:
    zone_id: str
    pumps: int
    peak_risk: float
    peak_band: str
    peak_depth_cm: float
    flooded_h: float
    first_flood_tick: int | None
    time_to_drain_h: float
    damage_qar: float
    population: int
    has_underpass: bool


@dataclass
class _ZoneRun:
    """One zone's mass balance under a scenario; risk is scored afterwards in a single batch."""

    p: ZoneParams
    pumps: int
    peak_depth: float
    flooded_ticks: int
    first_flood: int | None
    rows: list[list[float]]  # risk features per tick
    depths: list[float]  # hotspot depth per tick (for the physics fallback only)


def _run_zone(p: ZoneParams, rain: list[float], dt_h: float, scen: Scenario) -> _ZoneRun:
    pp = replace(p, drainage_capacity_mm_h=p.drainage_capacity_mm_h * (1.0 + scen.drain_upgrade_pct / 100.0))
    pumps = max(0, int(scen.allocations.get(p.zone_id, 0)))
    pump_cm_h = pumps * PUMP_TRUCK_M3_H / hotspot_basin_m2(pp) * 100.0  # drawdown at the hotspot
    delay_ticks = 0 if scen.prepositioned else round(REACTIVE_DEPLOY_DELAY_H / dt_h)
    window = max(1, round(3.0 / dt_h))

    state = ZoneState()
    hot = prev_phys = 0.0
    first_flood: int | None = None
    flooded_ticks = 0
    peak_depth = 0.0
    recent: list[float] = []
    rows: list[list[float]] = []
    depths: list[float] = []
    for i, r0 in enumerate(rain):
        r = r0 * scen.storm_multiplier
        state = physics.step(pp, state, r, dt_h)
        phys = state.depth_cm(pp)
        # The hotspot follows the zone's water minus what the pumps have removed since they arrived.
        hot = max(0.0, hot + (phys - prev_phys))
        prev_phys = phys
        if first_flood is not None and i >= first_flood + delay_ticks and hot > 0:
            hot = max(0.0, hot - pump_cm_h * dt_h)
        if hot >= physics.FLOOD_DEPTH_CM:
            flooded_ticks += 1
            if first_flood is None:
                first_flood = i
        recent.append(r)
        if len(recent) > window:
            recent.pop(0)
        rows.append(risk_features(pp, r, sum(recent) * dt_h))
        depths.append(hot)
        peak_depth = max(peak_depth, hot)
    return _ZoneRun(pp, pumps, peak_depth, flooded_ticks, first_flood, rows, depths)


def _score(runs: list[_ZoneRun], registry: Registry) -> list[float]:
    """Peak risk per zone from ONE batched model call (5,000 single-row predicts would take seconds)."""
    if registry.available:
        risks = registry.risk_scores(np.asarray([row for run in runs for row in run.rows]))
        out, k = [], 0
        for run in runs:
            out.append(float(risks[k : k + len(run.rows)].max()) if run.rows else 0.0)
            k += len(run.rows)
        return out
    return [
        max(
            (physics.risk_score(run.p, row[0], row[1], d) for row, d in zip(run.rows, run.depths, strict=True)),
            default=0.0,
        )
        for run in runs
    ]


def _outcome(run: _ZoneRun, peak_risk: float, dt_h: float, registry: Registry, original: ZoneParams) -> ZoneOutcome:
    p, pp = original, run.p
    flooded_h = run.flooded_ticks * dt_h
    ttd = registry.time_to_drain(
        hotspot_volume_m3(pp, run.peak_depth), run.pumps * PUMP_TRUCK_M3_H, hotspot_drainage_m3_h(pp), 0.0
    )
    damage = flooded_h * p.population * DAMAGE_QAR_PER_PERSON_FLOOD_H
    if p.has_underpass:
        damage += flooded_h * UNDERPASS_CLOSURE_QAR_PER_H
    return ZoneOutcome(
        zone_id=p.zone_id,
        pumps=run.pumps,
        peak_risk=round(peak_risk, 1),
        peak_band=physics.band(peak_risk),
        peak_depth_cm=round(run.peak_depth, 1),
        flooded_h=round(flooded_h, 2),
        first_flood_tick=run.first_flood,
        time_to_drain_h=ttd if run.peak_depth >= physics.FLOOD_DEPTH_CM else 0.0,
        damage_qar=round(damage),
        population=p.population,
        has_underpass=p.has_underpass,
    )


def simulate_zones(
    scen: Scenario, zones: list[ZoneParams], rain: dict[str, list[float]], dt_h: float, registry: Registry
) -> list[ZoneOutcome]:
    runs = [_run_zone(p, rain[p.zone_id], dt_h, scen) for p in zones]
    peaks = _score(runs, registry)
    return [_outcome(run, peak, dt_h, registry, p) for run, peak, p in zip(runs, peaks, zones, strict=True)]


def kpis(outcomes: list[ZoneOutcome]) -> dict:
    flooded = [o for o in outcomes if o.flooded_h > 0]
    return {
        "zones_flooded": len(flooded),
        "zones_red": sum(1 for o in outcomes if o.peak_risk >= physics.BAND_RED),
        "zones_at_risk": sum(1 for o in outcomes if o.peak_risk >= physics.BAND_ORANGE),
        "all_clear_h": round(max((o.time_to_drain_h for o in flooded), default=0.0), 1),
        "total_flooded_h": round(sum(o.flooded_h for o in outcomes), 1),
        "population_affected": sum(o.population for o in outcomes if o.peak_risk >= physics.BAND_ORANGE),
        "roads_closed_km": round(sum(ROAD_KM_PER_UNDERPASS_ZONE for o in flooded if o.has_underpass), 1),
        "damage_qar": round(sum(o.damage_qar for o in outcomes)),
        "pumps_deployed": sum(o.pumps for o in outcomes),
    }


def simulate(
    scen: Scenario,
    zones: list[ZoneParams],
    rain: dict[str, list[float]],
    tick_minutes: int,
    registry: Registry,
    baseline: dict | None = None,
) -> dict:
    t0 = time.perf_counter()
    dt_h = tick_minutes / 60.0
    outcomes = simulate_zones(scen, zones, rain, dt_h, registry)
    k = kpis(outcomes)
    base = baseline or kpis(simulate_zones(Scenario(), zones, rain, dt_h, registry))
    delta = {key: round(k[key] - base[key], 1) if isinstance(k[key], float) else k[key] - base[key] for key in k}
    return {
        "scenario": asdict(scen),
        "zones": [asdict(o) for o in outcomes],
        "kpis": k,
        "baseline": base,
        "delta": delta,
        "sources": {
            "risk": registry.risk_source,
            "time_to_drain": registry.drain["version"] if registry.available and registry.drain else "mass_balance",
        },
        "assumptions": {
            "pump_truck_m3_h": PUMP_TRUCK_M3_H,
            "reactive_deploy_delay_h": REACTIVE_DEPLOY_DELAY_H,
            "hotspot_basin_m2": {
                "underpass": hotspot_basin_m2(ZoneParams("u", 0, 0, 0, True)),
                "street": hotspot_basin_m2(ZoneParams("s", 0, 0, 0, False)),
            },
            "damage_qar_per_person_flood_h": DAMAGE_QAR_PER_PERSON_FLOOD_H,
            "underpass_closure_qar_per_h": UNDERPASS_CLOSURE_QAR_PER_H,
            "note": "Decision-support arithmetic, not a hydrological model; damage constants are illustrative.",
        },
        "elapsed_ms": round((time.perf_counter() - t0) * 1000, 1),
    }
