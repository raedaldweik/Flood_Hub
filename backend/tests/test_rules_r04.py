"""R-04 fires on the look-ahead forecast, once per zone, and never when trucks are already staged."""

from datetime import UTC, datetime

from sadd.rules import evaluate_timeline
from sadd.rules.rules import RuleInputs, get_rule
from sadd.sim import ZoneParams, build_timeline, interpolate_ticks

META = {
    "najma": {"name_en": "Najma", "name_ar": "نجمة", "has_underpass": True, "drainage_capacity_mm_h": 10},
    "campus": {"name_en": "Campus", "name_ar": "الحرم", "has_underpass": False, "drainage_capacity_mm_h": 30},
}


def _states():
    start = datetime(2024, 4, 16, 0, 0, tzinfo=UTC)
    hourly = [0, 0, 0, 0, 0, 0, 5, 15, 25, 25, 12, 2, 0, 0, 0, 0, 0, 0]
    zones = [ZoneParams("najma", 92, 10, 7, True), ZoneParams("campus", 55, 30, 30, False)]
    return build_timeline(start, 10, zones, {z.zone_id: interpolate_ticks(hourly, 10) for z in zones})


def test_r04_recommends_hours_before_the_first_orange_alert():
    out = evaluate_timeline(_states(), META, tick_minutes=10)
    recs = [d for d in out.decisions if d.rule_id == "R-04"]
    assert [d.zone_id for d in recs] == ["najma"]  # once, and only for the zone that will reach orange
    first_orange = min(a.tick for a in out.alerts if a.zone_id == "najma" and a.severity == "orange")
    assert 0 < first_orange - recs[0].tick <= 36  # within the 6 h horizon, ahead of the alert
    assert recs[0].output["forecast_source"].startswith("replay look-ahead")


def test_r04_is_silent_when_trucks_are_staged():
    out = evaluate_timeline(_states(), META, tick_minutes=10, staged_assets={"najma": 2})
    assert not [d for d in out.decisions if d.rule_id == "R-04"]


def test_r04_inputs_contract():
    x = RuleInputs(
        tick=1,
        ts=datetime(2024, 4, 16, tzinfo=UTC),
        zone_id="najma",
        zone_name_en="Najma",
        zone_name_ar="نجمة",
        risk=5,
        rain_mm_h=0,
        cum_3h_mm=0,
        depth_cm=0,
        exceedance_mm_h=0,
        drainage_capacity_mm_h=10,
        flooded=False,
        has_underpass=True,
        consecutive_ge_red=0,
        consecutive_below_clear=1,
        active_level=None,
        forecast_risk_6h=72.0,
        forecast_source="test",
        staged_assets=0,
    )
    d = get_rule("R-04").evaluate(x)
    assert d and d.decision_type == "recommendation" and d.alert_type == "preposition_pumps" and d.severity is None
    assert (
        get_rule("R-04").evaluate(RuleInputs(**{**x.__dict__, "open_recommendations": ("preposition_pumps",)})) is None
    )
    assert get_rule("R-04").evaluate(RuleInputs(**{**x.__dict__, "risk": 65.0})) is None  # too late to pre-position
