from datetime import datetime, timedelta, timezone

import pytest

from sadd.rules import RULES, RuleInputs, catalog, evaluate_timeline, get_rule
from sadd.rules.rules import (
    CLEAR_CONSECUTIVE_TICKS,
    R01RedAlert,
    R02OrangeAlert,
    R03UnderpassClosure,
    R06YellowWatch,
    R07ClearDown,
)
from sadd.sim.replay import TickState

T0 = datetime(2024, 4, 16, 9, 0, tzinfo=timezone(timedelta(hours=3)))


def inputs(**over) -> RuleInputs:
    base = dict(
        tick=10, ts=T0, zone_id="najma", zone_name_en="Najma", zone_name_ar="نجمة",
        risk=85.0, rain_mm_h=25.0, cum_3h_mm=55.0, depth_cm=30.0, exceedance_mm_h=13.0,
        drainage_capacity_mm_h=10.0, flooded=True, has_underpass=True,
        consecutive_ge_red=2, consecutive_below_clear=0, active_level=None,
    )
    base.update(over)
    return RuleInputs(**base)


# ── R-01 ─────────────────────────────────────────────────────────────────────
def test_r01_fires_after_two_consecutive_red_ticks():
    d = R01RedAlert().evaluate(inputs(consecutive_ge_red=2))
    assert d and d.severity == "red" and d.rule_id == "R-01" and d.notified
    assert "Najma" in d.message_en and "نجمة" in d.message_ar


def test_r01_waits_for_the_second_tick():
    assert R01RedAlert().evaluate(inputs(consecutive_ge_red=1)) is None


def test_r01_does_not_refire_while_red_is_active():
    assert R01RedAlert().evaluate(inputs(active_level="red")) is None


def test_r01_escalates_from_orange():
    d = R01RedAlert().evaluate(inputs(active_level="orange"))
    assert d and d.severity == "red"


# ── R-02 ─────────────────────────────────────────────────────────────────────
def test_r02_fires_at_60():
    d = R02OrangeAlert().evaluate(inputs(risk=60.0, consecutive_ge_red=0))
    assert d and d.severity == "orange"


def test_r02_silent_below_60_and_when_orange_or_red_active():
    assert R02OrangeAlert().evaluate(inputs(risk=59.9)) is None
    assert R02OrangeAlert().evaluate(inputs(risk=70, active_level="orange")) is None
    assert R02OrangeAlert().evaluate(inputs(risk=70, active_level="red")) is None


# ── R-06 ─────────────────────────────────────────────────────────────────────
def test_r06_yellow_watch_only_when_nothing_active():
    assert R06YellowWatch().evaluate(inputs(risk=45, active_level=None)).severity == "yellow"
    assert R06YellowWatch().evaluate(inputs(risk=45, active_level="yellow")) is None
    assert R06YellowWatch().evaluate(inputs(risk=39.9, active_level=None)) is None


# ── R-03 ─────────────────────────────────────────────────────────────────────
def test_r03_closes_underpass_only_on_red_in_underpass_zone():
    d = R03UnderpassClosure().evaluate(inputs(active_level="red", has_underpass=True))
    assert d and d.decision_type == "action_item" and d.alert_type == "underpass_closure"
    assert d.output["requires_operator_confirmation"] is True
    assert R03UnderpassClosure().evaluate(inputs(active_level="red", has_underpass=False)) is None
    assert R03UnderpassClosure().evaluate(inputs(active_level="red", open_action_items=("underpass_closure",))) is None
    assert R03UnderpassClosure().evaluate(inputs(active_level="orange", has_underpass=True)) is None


# ── R-07 ─────────────────────────────────────────────────────────────────────
def test_r07_clears_after_sustained_low_risk():
    d = R07ClearDown().evaluate(
        inputs(risk=10, active_level="orange", consecutive_below_clear=CLEAR_CONSECUTIVE_TICKS)
    )
    assert d and d.decision_type == "clear" and d.output["cleared_level"] == "orange"
    assert (
        R07ClearDown().evaluate(
            inputs(risk=10, active_level="orange", consecutive_below_clear=CLEAR_CONSECUTIVE_TICKS - 1)
        )
        is None
    )
    assert R07ClearDown().evaluate(inputs(risk=10, active_level=None, consecutive_below_clear=99)) is None


# ── registry ─────────────────────────────────────────────────────────────────
def test_catalog_lists_every_rule_with_version_and_bilingual_text():
    cat = catalog()
    assert [c["id"] for c in cat] == [r.id for r in RULES]
    for c in cat:
        assert c["version"] and c["description_en"] and c["description_ar"]
    assert get_rule("R-01").version == "1.0"
    with pytest.raises(KeyError):
        get_rule("R-99")


# ── engine end-to-end ────────────────────────────────────────────────────────
def series(risks: list[float], zone="najma", flooded_from: int | None = None) -> list[TickState]:
    return [
        TickState(tick=i, ts=T0 + timedelta(minutes=10 * i), zone_id=zone, rain_mm_h=20, cum_3h_mm=40,
                  exceedance_mm_h=8, depth_cm=20, flooded=(flooded_from is not None and i >= flooded_from), risk=r)
        for i, r in enumerate(risks)
    ]


META = {"najma": {"name_en": "Najma", "name_ar": "نجمة", "has_underpass": True, "drainage_capacity_mm_h": 10.0}}


def test_engine_escalates_yellow_orange_red_then_closes_underpass_then_clears():
    risks = [45, 65, 85, 85, 85, 30, 30, 30, 30, 30, 30, 30]
    out = evaluate_timeline(series(risks), META)
    fired = [(a.tick, a.severity, a.alert_type) for a in out.alerts]
    assert fired == [
        (0, "yellow", "zone_risk"),
        (1, "orange", "zone_risk"),
        (3, "red", "zone_risk"),          # second consecutive ≥80 tick
        (3, "red", "underpass_closure"),  # R-03 rides on the same tick
    ]
    # all four alerts cleared by R-07 at tick 10 (6 ticks below 40: ticks 5..10)
    assert all(a.cleared_tick == 10 for a in out.alerts)
    assert [d.rule_id for d in out.decisions if d.rule_id != "R-04"] == ["R-06", "R-02", "R-01", "R-03", "R-07"]
    assert "R-04" in [d.rule_id for d in out.decisions]  # the pre-position advice is in the ledger too
    assert all(d.inputs["zone_id"] == "najma" and "risk" in d.inputs for d in out.decisions)


def test_engine_never_fires_on_a_calm_series():
    out = evaluate_timeline(series([0, 5, 10, 20, 39.9, 12]), META)
    assert out.alerts == [] and out.decisions == []


def test_engine_can_re_alert_after_a_clear():
    risks = [65] + [10] * 6 + [65]
    out = evaluate_timeline(series(risks), META)
    assert [(a.tick, a.severity) for a in out.alerts] == [(0, "orange"), (7, "orange")]
    assert out.alerts[0].cleared_tick == 6 and out.alerts[1].cleared_tick is None
