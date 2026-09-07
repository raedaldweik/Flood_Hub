"""Versioned rules — pure functions from a RuleInputs snapshot to a Decision (or None).

Adding a rule = add a class, register it in RULES, add tests. Changing a threshold = bump
`version`. The decision log records id + version + the exact inputs, so any historical
decision can be replayed against the code that made it.

The zone-risk ladder (R-06 yellow → R-02 orange → R-01 red), the underpass closure action
item (R-03), the clear-down rule (R-07), forecast pre-positioning (R-04), agent plan
validation (R-05 — the only gate through which an agent proposal can touch asset state) and the
operator stand-down (R-08 — the only way the fleet returns to depots).
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
    consecutive_ge_red: int  # ticks (incl. current) with risk ≥ RED_THRESHOLD
    consecutive_below_clear: int  # ticks (incl. current) with risk < CLEAR_BELOW
    active_level: Severity | None  # currently active alert level for the zone
    open_action_items: tuple[str, ...] = ()  # alert types of action items already open for the zone
    forecast_risk_6h: float | None = None  # max forecast risk over the next 6 h (None = no forecast)
    forecast_source: str = ""  # where the forecast came from (replay look-ahead, gauge forecast, …)
    staged_assets: int = 0  # pump trucks staged / en route / pumping in the zone
    open_recommendations: tuple[str, ...] = ()  # recommendation types already issued for the zone

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
        f"خطورة ≥ {RED_THRESHOLD:.0f} لفترتين متتاليتين → تنبيه أحمر ومسودة إرشاد عام (القالب FOC-TPL-06 §5)."
    )

    def evaluate(self, x: RuleInputs) -> Decision | None:
        if x.consecutive_ge_red < RED_CONSECUTIVE_TICKS or SEVERITY_RANK[x.active_level] >= 3:
            return None
        f = _fmt(x)
        return Decision(
            rule_id=self.id,
            rule_version=self.version,
            decision_type="alert",
            zone_id=x.zone_id,
            severity="red",
            alert_type="zone_risk",
            message_en=(
                f"RED ALERT — {x.zone_name_en}: risk {f['risk']}. Rain {f['rain']} mm/h against "
                f"{f['drain']} mm/h drainage; est. {f['depth']} cm at the low point."
            ),
            message_ar=(
                f"تنبيه أحمر — {x.zone_name_ar}: الخطورة {f['risk']}. أمطار {f['rain']} مم/س مقابل "
                f"صرف {f['drain']} مم/س؛ منسوب مقدر {f['depth']} سم عند النقطة المنخفضة."
            ),
            output={
                "threshold": RED_THRESHOLD,
                "consecutive_required": RED_CONSECUTIVE_TICKS,
                "advisory_template": "FOC-TPL-06 §5",
                "advisory_status": "DRAFT",
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
            rule_id=self.id,
            rule_version=self.version,
            decision_type="alert",
            zone_id=x.zone_id,
            severity="orange",
            alert_type="zone_risk",
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
            rule_id=self.id,
            rule_version=self.version,
            decision_type="alert",
            zone_id=x.zone_id,
            severity="yellow",
            alert_type="zone_risk",
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
        "RED alert AND zone has an underpass → action item: close underpass, divert traffic (protocol FOC-SOP-01 §2.1)."
    )
    description_ar = (
        "تنبيه أحمر ومنطقة تحتوي على نفق → بند إجراء: إغلاق النفق وتحويل المرور (البروتوكول FOC-SOP-01 §2.1)."
    )

    def evaluate(self, x: RuleInputs) -> Decision | None:
        # Fires on the same tick the red alert is raised (engine passes the post-R-01 level).
        if not x.has_underpass or x.active_level != "red" or "underpass_closure" in x.open_action_items:
            return None
        return Decision(
            rule_id=self.id,
            rule_version=self.version,
            decision_type="action_item",
            zone_id=x.zone_id,
            severity="red",
            alert_type="underpass_closure",
            message_en=f"CLOSE UNDERPASS — {x.zone_name_en}: barriers at both approaches; activate diversion route.",
            message_ar=f"إغلاق النفق — {x.zone_name_ar}: حواجز عند المدخلين؛ تفعيل مسار التحويل.",
            output={
                "protocol": "FOC-SOP-01 §3",
                "diversion": "zone file route",
                "requires_operator_confirmation": True,
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
            rule_id=self.id,
            rule_version=self.version,
            decision_type="clear",
            zone_id=x.zone_id,
            severity=None,
            alert_type="zone_risk",
            message_en=f"ALERT CLEARED — {x.zone_name_en}: risk below {CLEAR_BELOW:.0f} for 60 minutes.",
            message_ar=f"انتهاء التنبيه — {x.zone_name_ar}: الخطورة دون {CLEAR_BELOW:.0f} لمدة 60 دقيقة.",
            output={"cleared_level": x.active_level, "advisory_template": "FOC-TPL-06 §7"},
            notified=True,
        )


# Evaluation order matters: escalation rules highest-first, then dependents, then clear-down.
class R04PrePosition:
    id = "R-04"
    version = "1.0"
    name_en = "Pre-position pumps on forecast risk"
    name_ar = "تمركز مسبق للمضخات بناءً على التوقعات"
    description_en = (
        f"Forecast risk ≥ {ORANGE_THRESHOLD:.0f} within 6 h AND zero pump trucks staged in the zone "
        "→ PRE-POSITION recommendation (SOP FOC-SOP-02 §3). Issued once per zone until assets arrive."
    )
    description_ar = (
        f"خطورة متوقعة ≥ {ORANGE_THRESHOLD:.0f} خلال 6 ساعات ولا مضخات متمركزة في المنطقة "
        "→ توصية بالتمركز المسبق (الإجراء FOC-SOP-02 §3). تصدر مرة واحدة لكل منطقة حتى وصول الأصول."
    )

    def evaluate(self, x: RuleInputs) -> Decision | None:
        if x.forecast_risk_6h is None or x.forecast_risk_6h < ORANGE_THRESHOLD:
            return None
        if x.staged_assets > 0 or "preposition_pumps" in x.open_recommendations or x.risk >= ORANGE_THRESHOLD:
            return None  # already covered, already recommended, or too late to be a pre-position
        return Decision(
            rule_id=self.id,
            rule_version=self.version,
            decision_type="recommendation",
            zone_id=x.zone_id,
            severity=None,
            alert_type="preposition_pumps",
            message_en=(
                f"PRE-POSITION — {x.zone_name_en}: forecast risk {x.forecast_risk_6h:.0f} within 6 h "
                f"(now {x.risk:.0f}) and no pump trucks staged. Stage trucks now — SOP FOC-SOP-02 §3."
            ),
            message_ar=(
                f"تمركز مسبق — {x.zone_name_ar}: خطورة متوقعة {x.forecast_risk_6h:.0f} خلال 6 ساعات "
                f"(حالياً {x.risk:.0f}) ولا مضخات متمركزة. تمركزوا الآن — الإجراء FOC-SOP-02 §3."
            ),
            output={
                "threshold": ORANGE_THRESHOLD,
                "horizon_h": 6,
                "forecast_risk_6h": x.forecast_risk_6h,
                "forecast_source": x.forecast_source,
                "staged_assets": x.staged_assets,
                "sop": "FOC-SOP-02 §3",
            },
        )


class R05PlanValidation:
    """Validates an agent-proposed dispatch plan. Does not fire on the timeline; `validate` is called by
    rules.dispatch.validate_and_apply — the ONLY path that changes asset state (CLAUDE.md §7)."""

    id = "R-05"
    version = "1.0"
    name_en = "Validate agent dispatch plan before execution"
    name_ar = "التحقق من خطة إرسال الوكيل قبل التنفيذ"
    description_en = (
        "Agent-proposed plan → every zone must exist, allocations ≥ 0 and integer, total ≤ pump fleet, "
        "and only zones at yellow or above (or with a pre-position recommendation) may receive trucks. "
        "Applied only after an operator clicks APPROVE; the approval is logged with the operator id."
    )
    description_ar = (
        "خطة يقترحها الوكيل → كل منطقة يجب أن تكون موجودة، والتخصيصات ≥ 0 وأعداد صحيحة، والمجموع ≤ أسطول "
        "المضخات، ولا تُرسل شاحنات إلا لمناطق عند الأصفر فأعلى (أو ذات توصية تمركز مسبق). "
        "تُطبق فقط بعد ضغط المشغل على اعتماد؛ ويُسجل الاعتماد مع معرف المشغل."
    )

    def evaluate(self, x: RuleInputs) -> Decision | None:  # noqa: ARG002 — not a timeline rule
        return None

    def validate(self, plan: dict, fleet_size: int, zones: dict[str, dict]) -> list[str]:
        """Return the list of violations (empty = valid). `zones[id]` needs `risk` and `recommended`."""
        errors: list[str] = []
        alloc = plan.get("allocations") or {}
        if not isinstance(alloc, dict) or not alloc:
            return ["plan has no allocations"]
        total = 0
        for zid, n in alloc.items():
            if zid not in zones:
                errors.append(f"unknown zone {zid}")
                continue
            if not isinstance(n, int) or isinstance(n, bool) or n < 0:
                errors.append(f"{zid}: allocation must be a non-negative integer")
                continue
            total += n
            z = zones[zid]
            if n > 0 and z.get("risk", 0.0) < YELLOW_THRESHOLD and not z.get("recommended", False):
                errors.append(
                    f"{zid}: risk {z.get('risk', 0):.0f} is below the yellow band "
                    "and no pre-position recommendation is open"
                )
        if total > fleet_size:
            errors.append(f"{total} trucks requested, fleet has {fleet_size}")
        if total == 0 and not errors:
            errors.append("plan allocates no trucks")
        return errors


class R08StandDown:
    """Operator stand-down of the whole fleet. Not a timeline rule; `validate` is called by
    rules.dispatch.stand_down — the second and last path that touches asset state (both live in dispatch.py)."""

    id = "R-08"
    version = "1.0"
    name_en = "Operator stand-down of the fleet"
    name_ar = "إنهاء انتشار الأسطول بأمر المشغل"
    description_en = (
        "Operator-initiated stand-down → every unit returns to its depot as idle. Requires an operator id and "
        "a non-empty fleet; nothing else can reset asset state. Logged with the fleet snapshot before and after."
    )
    description_ar = (
        "إنهاء انتشار بأمر المشغل → تعود كل وحدة إلى مستودعها في وضع الخمول. يتطلب معرف مشغل وأسطولاً "
        "غير فارغ؛ ولا يمكن لأي مسار آخر إعادة ضبط حالة الأصول. يُسجل مع لقطة الأسطول قبل وبعد."
    )

    def evaluate(self, x: RuleInputs) -> Decision | None:  # noqa: ARG002 — not a timeline rule
        return None

    def validate(self, operator_id: str, fleet_size: int) -> list[str]:
        errors: list[str] = []
        if not isinstance(operator_id, str) or len(operator_id.strip()) < 2:
            errors.append("an operator id is required to stand the fleet down")
        if fleet_size <= 0:
            errors.append("no units to stand down")
        return errors


RULES: list[Rule] = [
    R01RedAlert(),
    R02OrangeAlert(),
    R06YellowWatch(),
    R03UnderpassClosure(),
    R04PrePosition(),
    R07ClearDown(),
    R05PlanValidation(),
    R08StandDown(),
]


def get_rule(rule_id: str) -> Rule:
    for r in RULES:
        if r.id == rule_id:
            return r
    raise KeyError(rule_id)


def catalog() -> list[dict]:
    """Serialisable rule catalog for the Governance tab and /api/rules."""
    return [
        {
            "id": r.id,
            "version": r.version,
            "name_en": r.name_en,
            "name_ar": r.name_ar,
            "description_en": r.description_en,
            "description_ar": r.description_ar,
        }
        for r in RULES
    ]
