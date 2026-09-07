"""The two trained models: they exist, they are accurate, and they behave like the physics they learned."""

import pytest

from sadd.models import Registry
from sadd.models.features import RISK_FEATURES, ttd_truth_hours
from sadd.models.train import run
from sadd.sim import physics
from sadd.sim.physics import ZoneParams

NAJMA = ZoneParams("najma", 92, 10, 7, True, area_km2=3.1, population=42000)
CAMPUS = ZoneParams("education_city", 55, 30, 30, False, area_km2=10.0, population=12000)


@pytest.fixture(scope="module")
def registry(tmp_path_factory):
    out = tmp_path_factory.mktemp("artifacts")
    meta = run(out)
    assert meta["elapsed_s"] < 60
    r = Registry(out)
    assert r.available, r.error
    return r


def test_training_quality_and_importances(registry):
    risk, drain = registry.risk, registry.drain
    assert risk["metrics"]["r2"] > 0.95 and risk["metrics"]["mae"] < 4
    assert drain["metrics"]["r2"] > 0.95 and drain["metrics"]["mae_h"] < 1.5
    imp = risk["importances"]
    assert set(imp) == set(RISK_FEATURES) and abs(sum(imp.values()) - 1) < 1e-3
    assert imp["rain_mm_h"] + imp["cum_3h_mm"] > 0.6  # rain drives risk, as in the generator


def test_risk_is_monotonic_in_rain_and_tracks_physics(registry):
    scores = [registry.risk_score(NAJMA, rain, rain * 2.2) for rain in (0, 5, 12, 25, 45)]
    assert all(b >= a - 1.5 for a, b in zip(scores[:-1], scores[1:], strict=True))
    assert scores[0] < 15 and scores[-1] >= 80
    # The low-drainage underpass zone scores higher than the campus under the same rain.
    assert registry.risk_score(NAJMA, 25, 55) > registry.risk_score(CAMPUS, 25, 55) + 15
    # Within a few points of the formula it was trained on.
    for rain, cum3 in ((8, 15), (25, 55), (40, 100)):
        surface = max(0.0, cum3 * NAJMA.imperviousness_pct / 100 - NAJMA.drainage_capacity_mm_h * 3 * 0.75)
        depth = surface * NAJMA.concentration / 10
        assert abs(registry.risk_score(NAJMA, rain, cum3) - physics.risk_score(NAJMA, rain, cum3, depth)) < 12


def test_contributions_explain_the_score(registry):
    out = registry.risk_contributions(NAJMA, 30, 70)
    assert out["source"] == registry.risk_source != physics.RISK_SOURCE
    total = out["baseline"] + sum(c["points"] for c in out["contributions"])
    assert abs(total - out["risk"]) < 0.5
    drivers = {c["driver"]: c["points"] for c in out["contributions"]}
    assert drivers["rain_intensity"] > 0 and drivers["cumulative_3h"] > 0 and drivers["underpass"] > 0


def test_time_to_drain_follows_the_mass_balance(registry):
    volume, drainage = 2400.0, 96.0  # a flooded underpass basin: 30 cm over 8,000 m²; local drains at 12 mm/h
    hours = [registry.time_to_drain(volume, pumps * 250.0, drainage, 0.0) for pumps in (0, 1, 2, 4)]
    assert all(b < a for a, b in zip(hours[:-1], hours[1:], strict=True))  # every truck helps
    assert abs(hours[2] - ttd_truth_hours(volume, 500.0, drainage, 0.0)) < 1.5
    assert registry.time_to_drain(volume, 0.0, drainage, 5000.0) >= 40  # still pouring in: capped
    assert registry.time_to_drain(0.0, 500.0, drainage, 0.0) == 0.0


def test_missing_artifacts_fall_back_to_physics(tmp_path):
    r = Registry(tmp_path / "nowhere")
    assert not r.available and r.risk_source == physics.RISK_SOURCE
    assert r.risk_score(NAJMA, 25, 55, 20) == physics.risk_score(NAJMA, 25, 55, 20)
    out = r.risk_contributions(NAJMA, 25, 55, 20)
    assert out["source"] == physics.RISK_SOURCE and out["contributions"][0]["driver"] == "rain_intensity"
    assert r.time_to_drain(2400, 500, 96, 0) == pytest.approx(ttd_truth_hours(2400, 500, 96, 0), abs=0.01)
