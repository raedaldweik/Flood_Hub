"""The what-if engine: the levers move the outcomes the right way, fast enough for a slider."""

import time

import pytest

from sadd.models import Registry
from sadd.models.train import run
from sadd.sim import interpolate_ticks
from sadd.sim.physics import ZoneParams
from sadd.sim.whatif import Scenario, simulate

ZONES = [
    ZoneParams("najma", 92, 10, 7, True, area_km2=3.1, population=42000, criticality=5),
    ZoneParams("al_sadd", 90, 12, 9, True, area_km2=4.2, population=38000, criticality=4),
    ZoneParams("education_city", 55, 30, 30, False, area_km2=10.0, population=12000, criticality=2),
]
STORM = [0, 0, 1, 3, 6, 12, 20, 26, 24, 15, 8, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]  # 24 h, mm per hour


@pytest.fixture(scope="module")
def registry(tmp_path_factory):
    out = tmp_path_factory.mktemp("artifacts")
    run(out)
    return Registry(out)


@pytest.fixture(scope="module")
def rain():
    return {z.zone_id: interpolate_ticks(STORM, 10) for z in ZONES}


def test_baseline_floods_the_underpasses_only(registry, rain):
    out = simulate(Scenario(), ZONES, rain, 10, registry)
    by = {z["zone_id"]: z for z in out["zones"]}
    assert by["najma"]["flooded_h"] > 0 and by["al_sadd"]["flooded_h"] > 0 and by["education_city"]["flooded_h"] == 0
    assert by["najma"]["peak_band"] == "red" and by["education_city"]["peak_band"] in ("green", "yellow")
    assert out["kpis"]["zones_flooded"] == 2 and out["kpis"]["all_clear_h"] > 0
    assert out["delta"]["damage_qar"] == 0  # baseline vs itself


def test_pumps_and_prepositioning_cut_flooded_hours_and_time_to_drain(registry, rain):
    base = simulate(Scenario(), ZONES, rain, 10, registry)
    pumped = simulate(Scenario(allocations={"najma": 4}), ZONES, rain, 10, registry, baseline=base["kpis"])
    staged = simulate(
        Scenario(allocations={"najma": 4}, prepositioned=True), ZONES, rain, 10, registry, baseline=base["kpis"]
    )
    b, p, s = (dict((z["zone_id"], z) for z in o["zones"])["najma"] for o in (base, pumped, staged))
    assert p["time_to_drain_h"] < b["time_to_drain_h"]
    assert s["flooded_h"] < p["flooded_h"] <= b["flooded_h"]
    assert staged["delta"]["damage_qar"] < pumped["delta"]["damage_qar"] <= 0
    assert pumped["kpis"]["pumps_deployed"] == 4


def test_storm_multiplier_and_drain_upgrade(registry, rain):
    base = simulate(Scenario(), ZONES, rain, 10, registry)
    worse = simulate(Scenario(storm_multiplier=1.5), ZONES, rain, 10, registry, baseline=base["kpis"])
    better = simulate(Scenario(drain_upgrade_pct=40), ZONES, rain, 10, registry, baseline=base["kpis"])
    assert worse["kpis"]["total_flooded_h"] > base["kpis"]["total_flooded_h"]
    assert worse["delta"]["damage_qar"] > 0
    assert better["kpis"]["total_flooded_h"] < base["kpis"]["total_flooded_h"]


def test_fast_enough_for_a_slider(registry):
    zones = [ZoneParams(f"z{i}", 90, 10 + i, 8, i % 2 == 0, area_km2=4, population=30000) for i in range(12)]
    rain = {z.zone_id: interpolate_ticks(STORM * 3, 10) for z in zones}  # 72 h × 12 zones = 5,184 ticks
    base = simulate(Scenario(), zones, rain, 10, registry)
    t0 = time.perf_counter()
    out = simulate(
        Scenario(storm_multiplier=1.3, allocations={"z0": 3, "z2": 2}), zones, rain, 10, registry, baseline=base["kpis"]
    )
    assert (time.perf_counter() - t0) * 1000 < 300 and out["elapsed_ms"] < 300
