"""R-08: the operator stand-down is a gate rule — validated on demand, never fired on the timeline."""

from datetime import UTC, datetime

from sadd.rules import RULES, RuleInputs, catalog, get_rule
from sadd.rules.rules import R08StandDown


def test_r08_is_registered_and_in_the_catalog():
    assert isinstance(get_rule("R-08"), R08StandDown)
    entry = next(r for r in catalog() if r["id"] == "R-08")
    assert entry["version"] == "1.0" and "depot" in entry["description_en"]
    assert RULES[-1].id == "R-08"


def test_r08_requires_an_operator_and_a_fleet():
    r = R08StandDown()
    assert r.validate("ops-01", 32) == []
    assert any("operator" in e for e in r.validate("", 32))
    assert any("operator" in e for e in r.validate("x", 32))
    assert any("no units" in e for e in r.validate("ops-01", 0))


def test_r08_never_fires_on_the_timeline():
    x = RuleInputs(
        tick=1,
        ts=datetime(2024, 4, 16, tzinfo=UTC),
        zone_id="najma",
        zone_name_en="Najma",
        zone_name_ar="نجمة",
        risk=95.0,
        rain_mm_h=40.0,
        cum_3h_mm=90.0,
        depth_cm=40.0,
        exceedance_mm_h=30.0,
        drainage_capacity_mm_h=10.0,
        flooded=True,
        has_underpass=True,
        consecutive_ge_red=5,
        consecutive_below_clear=0,
        active_level="red",
    )
    assert R08StandDown().evaluate(x) is None
