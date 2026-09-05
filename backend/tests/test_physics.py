from sadd.sim import ZoneParams, ZoneState, explain_risk, risk_score, step
from sadd.sim.physics import FLOOD_DEPTH_CM, band, exceedance_mm_h

UNDERPASS = ZoneParams(
    "najma", imperviousness_pct=92, drainage_capacity_mm_h=10, elevation_m=7, has_underpass=True
)
CAMPUS = ZoneParams(
    "education_city", imperviousness_pct=55, drainage_capacity_mm_h=30, elevation_m=30, has_underpass=False
)


def test_dry_zone_is_green_and_dry():
    assert risk_score(CAMPUS, 0, 0, 0) == 0
    assert band(risk_score(UNDERPASS, 0, 0, 0)) == "green"
    s = step(UNDERPASS, ZoneState(), rain_mm_h=0, dt_h=1)
    assert s.surface_mm == 0


def test_light_rain_drains_without_accumulating():
    s = step(UNDERPASS, ZoneState(), rain_mm_h=5, dt_h=1)  # inflow 4.6 < drainage 10
    assert s.surface_mm == 0
    assert exceedance_mm_h(UNDERPASS, 5) == 0


def test_violent_rain_floods_an_underpass_zone():
    s = ZoneState()
    for _ in range(18):  # 3 h of 25 mm/h at 10-min ticks
        s = step(UNDERPASS, s, rain_mm_h=25, dt_h=1 / 6)
    assert s.depth_cm(UNDERPASS) >= FLOOD_DEPTH_CM
    assert band(risk_score(UNDERPASS, 25, 75, s.depth_cm(UNDERPASS))) == "red"


def test_same_rain_is_milder_on_well_drained_campus():
    s = ZoneState()
    for _ in range(18):
        s = step(CAMPUS, s, rain_mm_h=25, dt_h=1 / 6)
    assert s.depth_cm(CAMPUS) == 0  # inflow 13.75 < drainage 30
    assert risk_score(CAMPUS, 25, 75, 0) < risk_score(UNDERPASS, 25, 75, 20)


def test_risk_is_monotonic_in_each_driver():
    base = risk_score(UNDERPASS, 10, 20, 5)
    assert risk_score(UNDERPASS, 20, 20, 5) > base
    assert risk_score(UNDERPASS, 10, 40, 5) > base
    assert risk_score(UNDERPASS, 10, 20, 15) > base
    assert 0 <= risk_score(UNDERPASS, 999, 999, 999) <= 100


def test_explanation_sums_to_score():
    parts = explain_risk(UNDERPASS, 24, 55, 30)
    assert {d for d, _ in parts} == {
        "rain_intensity", "cumulative_3h", "drainage_exceedance", "standing_water", "underpass", "low_elevation"
    }
    assert abs(sum(v for _, v in parts) - risk_score(UNDERPASS, 24, 55, 30)) < 0.11  # rounding


def test_recession_after_rain_stops():
    s = ZoneState(surface_mm=30)
    s2 = step(UNDERPASS, s, rain_mm_h=0, dt_h=1)  # drains 10 mm/h
    assert s2.surface_mm == 20
    s3 = step(UNDERPASS, s2, rain_mm_h=0, dt_h=5)
    assert s3.surface_mm == 0
