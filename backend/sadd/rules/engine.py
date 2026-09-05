"""Runs the rule set over a per-zone time series and emits alerts + decision-log rows.

Stateful bookkeeping (consecutive counters, current alert level) lives here; the rules
themselves stay pure. The same function will drive the live replay engine in Phase 2 —
it is deliberately independent of the database.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime

from ..sim.replay import TickState
from .rules import (
    CLEAR_BELOW,
    RED_THRESHOLD,
    RULES,
    Decision,
    RuleInputs,
    Severity,
)


@dataclass
class AlertRecord:
    ts: datetime
    tick: int
    zone_id: str
    severity: Severity
    alert_type: str
    message_en: str
    message_ar: str
    rule_id: str
    rule_version: str
    cleared_ts: datetime | None = None
    cleared_tick: int | None = None

    @property
    def status(self) -> str:
        return "cleared" if self.cleared_ts is not None else "active"


@dataclass
class DecisionRecord:
    ts: datetime
    tick: int
    decision_type: str
    zone_id: str
    rule_id: str
    rule_version: str
    inputs: dict
    output: dict
    proposed_by: str = "system"
    approved_by: str | None = None
    notified: bool = False


@dataclass
class EngineOutput:
    alerts: list[AlertRecord] = field(default_factory=list)
    decisions: list[DecisionRecord] = field(default_factory=list)


@dataclass
class _ZoneMemory:
    consecutive_ge_red: int = 0
    consecutive_below_clear: int = 0
    active_level: Severity | None = None
    open_alerts: list[AlertRecord] = field(default_factory=list)


def evaluate_timeline(
    states: list[TickState],
    zone_meta: dict[str, dict],
) -> EngineOutput:
    """zone_meta[zone_id] = {name_en, name_ar, has_underpass, drainage_capacity_mm_h}."""
    out = EngineOutput()
    memory: dict[str, _ZoneMemory] = defaultdict(_ZoneMemory)
    by_tick: dict[int, list[TickState]] = defaultdict(list)
    for s in states:
        by_tick[s.tick].append(s)

    for tick in sorted(by_tick):
        for s in sorted(by_tick[tick], key=lambda z: z.zone_id):
            m = memory[s.zone_id]
            meta = zone_meta[s.zone_id]
            m.consecutive_ge_red = m.consecutive_ge_red + 1 if s.risk >= RED_THRESHOLD else 0
            m.consecutive_below_clear = m.consecutive_below_clear + 1 if s.risk < CLEAR_BELOW else 0

            for rule in RULES:
                x = RuleInputs(
                    tick=s.tick, ts=s.ts, zone_id=s.zone_id,
                    zone_name_en=meta["name_en"], zone_name_ar=meta["name_ar"],
                    risk=s.risk, rain_mm_h=s.rain_mm_h, cum_3h_mm=s.cum_3h_mm,
                    depth_cm=s.depth_cm, exceedance_mm_h=s.exceedance_mm_h,
                    drainage_capacity_mm_h=meta["drainage_capacity_mm_h"],
                    flooded=s.flooded, has_underpass=meta["has_underpass"],
                    consecutive_ge_red=m.consecutive_ge_red,
                    consecutive_below_clear=m.consecutive_below_clear,
                    active_level=m.active_level,
                    open_action_items=tuple(a.alert_type for a in m.open_alerts if a.alert_type != "zone_risk"),
                )
                d = rule.evaluate(x)
                if d is None:
                    continue
                _apply(d, x, m, out)
    return out


def _apply(d: Decision, x: RuleInputs, m: _ZoneMemory, out: EngineOutput) -> None:
    out.decisions.append(
        DecisionRecord(
            ts=x.ts, tick=x.tick, decision_type=d.decision_type, zone_id=d.zone_id,
            rule_id=d.rule_id, rule_version=d.rule_version,
            inputs=x.snapshot(), output={**d.output, "message_en": d.message_en, "message_ar": d.message_ar},
            proposed_by=d.proposed_by, notified=d.notified,
        )
    )
    if d.decision_type == "alert" and d.severity is not None:
        rec = AlertRecord(
            ts=x.ts, tick=x.tick, zone_id=d.zone_id, severity=d.severity, alert_type=d.alert_type,
            message_en=d.message_en, message_ar=d.message_ar,
            rule_id=d.rule_id, rule_version=d.rule_version,
        )
        out.alerts.append(rec)
        m.open_alerts.append(rec)
        m.active_level = d.severity
    elif d.decision_type == "action_item" and d.severity is not None:
        rec = AlertRecord(
            ts=x.ts, tick=x.tick, zone_id=d.zone_id, severity=d.severity, alert_type=d.alert_type,
            message_en=d.message_en, message_ar=d.message_ar,
            rule_id=d.rule_id, rule_version=d.rule_version,
        )
        out.alerts.append(rec)
        m.open_alerts.append(rec)
    elif d.decision_type == "clear":
        for rec in m.open_alerts:
            rec.cleared_ts = x.ts
            rec.cleared_tick = x.tick
        m.open_alerts.clear()
        m.active_level = None
        m.consecutive_ge_red = 0
