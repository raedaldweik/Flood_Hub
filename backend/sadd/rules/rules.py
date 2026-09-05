"""Versioned rules — pure functions from a RuleInputs snapshot to a Decision (or None).

Adding a rule = add a class, register it in RULES, add tests. Changing a threshold = bump
`version`. The decision log records id + version + the exact inputs, so any historical
decision can be replayed against the code that made it.

Phase 1 ships the zone-risk ladder (R-06 yellow → R-02 orange → R-01 red), the underpass
closure action item (R-03) and the clear-down rule (R-07). R-04 (forecast pre-positioning)
and R-05 (agent plan validation) arrive with the forecast model and the agent (Phases 2–3).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Literal, Protocol

Severity = Literal["yellow", "orange", "red"]
SEVERITY_RANK: dict[str | None, int] = {None: 0, "yellow": 1, "orange": 2, "red": 3}

# Thresholds (mirrors sim.physics bands — kept here too so the rule file is self-contained).
RED_THRESHOLD = 80.0
ORANGE_THRESHOLD = 60.0
YELLOW_THRESHOLD = 40.0
RED_CONSECUTIVE_TICKS = 2
CLEAR_BELOW = 40.0
CLEAR_CONSECUTIVE_TICKS = 6  # 6 × 10-min ticks = 60 minutes below the yellow band


@dataclass(frozen=True)
class RuleInputs:
    """Everything a rule is allowed to look at. Snapshotted verbatim into decision_log."""

    tick: int
    ts: datetime
    zone_id: str
    zone_name_en: str
    zone_name_ar: str
    risk: float
    rain_mm_h: float
    cum_3h_mm: float
    depth_cm: float
    exceedance_mm_h: float
    drainage_capacity_mm_h: float
    flooded: bool
    has_underpass: bool
    consecutive_ge_red: int      # ticks (incl. current) with risk ≥ RED_THRESHOLD
    consecutive_below_clear: int  # ticks (incl. current) with risk < CLEAR_BELOW
    active_level: Severity | None  # currently active alert level for the zone
    open_action_items: tuple[str, ...] = ()  # alert types of action items already open for the zone

    def snapshot(self) -> dict:
        d = asdict(self)
        d["ts"] = self.ts.isoformat()
        return d


@dataclass(frozen=True)
class Decision:
    rule_id: str
    rule_version: str
    decision_type: Literal["alert", "clear", "action_item", "recommendation"]
    zone_id: str
    severity: Severity | None
    alert_type: str
    message_en: str
    message_ar: str
    output: dict = field(default_factory=dict)
    proposed_by: Literal["system", "agent", "operator"] = "system"
    notified: bool = False


class Rule(Protocol):
    id: str
    version: str
    name_en: str
    name_ar: str
    description_en: str
    description_ar: str

    def evaluate(self, x: RuleInputs) -> Decision | None: ...


def _fmt(x: RuleInputs) -> dict[str, str]:
    return {
        "rain": f"{x.rain_mm_h:.0f}",
        "drain": f"{x.drainage_capacity_mm_h:.0f}",
        "risk": f"{x.risk:.0f}",
        "depth": f"{x.depth_cm:.0f}",
    }


class R01RedAlert:
    id = "R-01"
    version = "1.0"
    name_en = "Red alert on sustained extreme risk"
    name_ar = "تنبيه أحمر عند خطورة قصوى مستمرة"
    description_en = (
        f"Risk ≥ {RED_THRESHOLD:.0f} for {RED_CONSECUTIVE_TICKS} consecutive intervals "
        "→ RED alert + public advisory draft (template FOC-TPL-06 §5)."
    )
    description_ar = (
        f"خطورة ≥ {RED_THRESHOLD:.0f} لفترتين متتاليتين → تنبيه أحمر ومسودة إرشاد عام "
        "(القالب FOC-TPL-06 §5)."
    )

    def evaluate(self, x: RuleInputs) -> Decision | None:
        if x.consecutive_ge_red < RED_CONSECUTIVE_TICKS or SEVERITY_RANK[x.active_level] >= 3:
            return None
        f = _fmt(x)
        return Decision(
            rule_id=self.id, rule_version=self.version, decision_type="alert",
            zone_id=x.zone_id, severity="red", alert_type="zone_risk",
            message_en=(
                f"RED ALERT — {x.zone_name_en}: risk {f['risk']}. Rain {f['rain']} mm/h against "
                f"{f['drain']} mm/h drainage; est. {f['depth']} cm at the low point."
            ),
            message_ar=(
                f"تنبيه أحمر — {x.zone_name_ar}: الخطورة {f['risk']}. أمطار {f['rain']} مم/س مقابل "
                f"صرف {f['drain']} مم/س؛ منسوب مقدر {f['depth']} سم عند النقطة المنخفضة."
            ),
            output={
                "threshold": RED_THRESHOLD, "consecutive_required": RED_CONSECUTIVE_TICKS,
                "advisory_template": "FOC-TPL-06 §5", "advisory_status": "DRAFT",
            },
            notified=True,
        )


class R02OrangeAlert:
    id = "R-02"
    version = "1.0"
    name_en = "Orange alert on high risk"
    name_ar = "تنبيه برتقالي عند خطورة عالية"
    description_en = f"Risk ≥ {ORANGE_THRESHOLD:.0f} → ORANGE alert (template FOC-TPL-06 §4)."
    description_ar = f"خطورة ≥ {ORANGE_THRESHOLD:.0f} → تنبيه برتقالي (القالب FOC-TPL-06 §4)."

    def evaluate(self, x: RuleInputs) -> Decision | None:
        if x.risk < ORANGE_THRESHOLD or SEVERITY_RANK[x.active_level] >= 2:
            return None
        f = _fmt(x)
        return Decision(
            rule_id=self.id, rule_version=self.version, decision_type="alert",
            zone_id=x.zone_id, severity="orange", alert_type="zone_risk",
            message_en=(
                f"ORANGE WARNING — {x.zone_name_en}: risk {f['risk']}. Street flooding likely; "
                f"rain {f['rain']} mm/h, drainage {f['drain']} mm/h."
            ),
            message_ar=(
                f"تحذير برتقالي — {x.zone_name_ar}: الخطورة {f['risk']}. غمر الشوارع محتمل؛ "
                f"أمطار {f['rain']} مم/س، صرف {f['drain']} مم/س."
            ),
            output={"threshold": ORANGE_THRESHOLD, "advisory_template": "FOC-TPL-06 §4"},
            notified=True,
        )


class R06YellowWatch:
    id = "R-06"
    version = "1.0"
    name_en = "Yellow watch on elevated risk"
    name_ar = "مراقبة صفراء عند خطورة مرتفعة"
    description_en = f"Risk ≥ {YELLOW_THRESHOLD:.0f} → YELLOW watch (template FOC-TPL-06 §3)."
    description_ar = f"خطورة ≥ {YELLOW_THRESHOLD:.0f} → مراقبة صفراء (القالب FOC-TPL-06 §3)."

    def evaluate(self, x: RuleInputs) -> Decision | None:
        if x.risk < YELLOW_THRESHOLD or SEVERITY_RANK[x.active_level] >= 1:
            return None
        f = _fmt(x)
        return Decision(
            rule_id=self.id, rule_version=self.version, decision_type="alert",
            zone_id=x.zone_id, severity="yellow", alert_type="zone_risk",
            message_en=(
                f"YELLOW WATCH — {x.zone_name_en}: risk {f['risk']}. Rain {f['rain']} mm/h; "
                "avoid underpasses and low ground."
            ),
            message_ar=(
                f"مراقبة صفراء — {x.zone_name_ar}: الخطورة {f['risk']}. أمطار {f['rain']} مم/س؛ "
                "تجنبوا الأنفاق والأراضي المنخفضة."
            ),
            output={"threshold": YELLOW_THRESHOLD, "advisory_template": "FOC-TPL-06 §3"},
            notified=True,
        )


class R03UnderpassClosure:
    id = "R-03"
    version = "1.0"
    name_en = "Close underpasses on red alert"
    name_ar = "إغلاق الأنفاق عند التنبيه الأحمر"
    description_en = (
        "RED alert AND zone has an underpass → action item: close underpass, divert traffic "
        "(protocol FOC-SOP-01 §2.1)."
    )
    description_ar = (
        "تنبيه أحمر ومنطقة تحتوي على نفق → بند إجراء: إغلاق النفق وتحويل المرور "
        "(البروتوكول FOC-SOP-01 §2.1)."
    )

    def evaluate(self, x: RuleInputs) -> Decision | None:
        # Fires on the same tick the red alert is raised (engine passes the post-R-01 level).
        if not x.has_underpass or x.active_level != "red" or "underpass_closure" in x.open_action_items:
            return None
        return Decision(
            rule_id=self.id, rule_version=self.version, decision_type="action_item",
            zone_id=x.zone_id, severity="red", alert_type="underpass_closure",
            message_en=f"CLOSE UNDERPASS — {x.zone_name_en}: barriers at both approaches; activate diversion route.",
            message_ar=f"إغلاق النفق — {x.zone_name_ar}: حواجز عند المدخلين؛ تفعيل مسار التحويل.",
            output={
                "protocol": "FOC-SOP-01 §3", "diversion": "zone file route", "requires_operator_confirmation": True,
            },
        )


class R07ClearDown:
    id = "R-07"
    version = "1.0"
    name_en = "Clear alert after sustained low risk"
    name_ar = "إنهاء التنبيه بعد انخفاض مستمر للخطورة"
    description_en = (
        f"Active alert AND risk < {CLEAR_BELOW:.0f} for {CLEAR_CONSECUTIVE_TICKS} consecutive "
        "intervals → CLEAR alert + stand-down message (template FOC-TPL-06 §7)."
    )
    description_ar = (
        f"تنبيه نشط وخطورة < {CLEAR_BELOW:.0f} لست فترات متتالية → إنهاء التنبيه ورسالة إنهاء الحالة "
        "(القالب FOC-TPL-06 §7)."
    )

    def evaluate(self, x: RuleInputs) -> Decision | None:
        if x.active_level is None or x.consecutive_below_clear < CLEAR_CONSECUTIVE_TICKS:
            return None
        return Decision(
            rule_id=self.id, rule_version=self.version, decision_type="clear",
            zone_id=x.zone_id, severity=None, alert_type="zone_risk",
            message_en=f"ALERT CLEARED — {x.zone_name_en}: risk below {CLEAR_BELOW:.0f} for 60 minutes.",
            message_ar=f"انتهاء التنبيه — {x.zone_name_ar}: الخطورة دون {CLEAR_BELOW:.0f} لمدة 60 دقيقة.",
            output={"cleared_level": x.active_level, "advisory_template": "FOC-TPL-06 §7"},
            notified=True,
        )


# Evaluation order matters: escalation rules highest-first, then dependents, then clear-down.
RULES: list[Rule] = [R01RedAlert(), R02OrangeAlert(), R06YellowWatch(), R03UnderpassClosure(), R07ClearDown()]


def get_rule(rule_id: str) -> Rule:
    for r in RULES:
        if r.id == rule_id:
            return r
    raise KeyError(rule_id)


def catalog() -> list[dict]:
    """Serialisable rule catalog for the Governance tab and /api/rules."""
    return [
        {
            "id": r.id, "version": r.version,
            "name_en": r.name_en, "name_ar": r.name_ar,
            "description_en": r.description_en, "description_ar": r.description_ar,
        }
        for r in RULES
    ]
