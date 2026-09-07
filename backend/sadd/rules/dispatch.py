"""The ONLY path that changes asset state: an agent-proposed plan, validated by R-05, applied after an
operator's APPROVE click, and written to the decision log with the operator id (CLAUDE.md §7).

Enforced in code, not convention: nothing else in the backend writes `assets.zone_id` or `assets.status`.
"""

from __future__ import annotations

from datetime import UTC, datetime

from psycopg.types.json import Jsonb

from ..db import connection
from .rules import R05PlanValidation, get_rule

R05 = get_rule("R-05")
assert isinstance(R05, R05PlanValidation)


class PlanRejected(Exception):
    def __init__(self, errors: list[str], decision_id: int | None = None) -> None:
        super().__init__("; ".join(errors))
        self.errors = errors
        self.decision_id = decision_id


def fleet_snapshot(conn) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, callsign, callsign_ar, type, capacity_m3_h, status, zone_id FROM assets "
            "WHERE type = 'pump_truck' ORDER BY id"
        )
        return cur.fetchall()


def validate_and_apply(plan: dict, operator_id: str, zone_context: dict[str, dict], tick: int | None = None) -> dict:
    """Validate `plan` with R-05 and, only if it passes, move trucks. Every outcome is logged.

    plan          = {"plan_id", "objective", "allocations": {zone_id: trucks}, "prepositioned": bool, ...}
    zone_context  = {zone_id: {"risk": float, "recommended": bool}} for R-05's eligibility check
    """
    now = datetime.now(UTC)
    with connection() as conn:
        fleet = fleet_snapshot(conn)
        errors = R05.validate(plan, len(fleet), zone_context)
        with conn.cursor() as cur:
            if errors:
                cur.execute(
                    """INSERT INTO decision_log (ts, tick, decision_type, zone_id, rule_id, rule_version, inputs_json,
                                                 output_json, proposed_by, approved_by, notified, source)
                       VALUES (%s,%s,'dispatch_rejected',NULL,%s,%s,%s,%s,'agent',%s,FALSE,'live') RETURNING id""",
                    (
                        now,
                        tick,
                        R05.id,
                        R05.version,
                        Jsonb({"plan": plan, "fleet_size": len(fleet), "zones": zone_context}),
                        Jsonb({"rejected": errors}),
                        operator_id,
                    ),
                )
                conn.commit()
                raise PlanRejected(errors, cur.fetchone()["id"])

            # Assign idle trucks first, then re-task the rest in id order — a transparent, greedy policy.
            alloc = {z: int(n) for z, n in plan["allocations"].items() if int(n) > 0}
            pool = sorted(fleet, key=lambda a: (a["status"] != "idle", a["id"]))
            status = "staged" if plan.get("prepositioned") else "enroute"
            assignments: list[dict] = []
            for zone_id, n in alloc.items():
                for _ in range(n):
                    if not pool:
                        break
                    a = pool.pop(0)
                    cur.execute("UPDATE assets SET zone_id = %s, status = %s WHERE id = %s", (zone_id, status, a["id"]))
                    assignments.append(
                        {
                            "asset_id": a["id"],
                            "callsign": a["callsign"],
                            "callsign_ar": a["callsign_ar"],
                            "capacity_m3_h": a["capacity_m3_h"],
                            "zone_id": zone_id,
                            "status": status,
                        }
                    )
            cur.execute(
                """INSERT INTO decision_log (ts, tick, decision_type, zone_id, rule_id, rule_version, inputs_json,
                                             output_json, proposed_by, approved_by, notified, source)
                   VALUES (%s,%s,'dispatch',NULL,%s,%s,%s,%s,'agent',%s,TRUE,'live') RETURNING id""",
                (
                    now,
                    tick,
                    R05.id,
                    R05.version,
                    Jsonb(
                        {
                            "plan": plan,
                            "fleet_size": len(fleet),
                            "zones": zone_context,
                            "fleet_before": [{k: a[k] for k in ("id", "status", "zone_id")} for a in fleet],
                        }
                    ),
                    Jsonb({"assignments": assignments, "trucks_moved": len(assignments)}),
                    operator_id,
                ),
            )
            decision_id = cur.fetchone()["id"]
        conn.commit()
    return {
        "decision_id": decision_id,
        "rule": f"{R05.id} v{R05.version}",
        "approved_by": operator_id,
        "assignments": assignments,
        "trucks_moved": len(assignments),
        "ts": now.isoformat(),
    }
