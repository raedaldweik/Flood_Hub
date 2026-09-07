"""The ONLY paths that change asset state (CLAUDE.md §7), both gated by a versioned rule and both logged:

  validate_and_apply(plan, operator_id, …)  — an agent-proposed plan, validated by R-05, applied after an
                                              operator's APPROVE click; trucks move to their zones.
  stand_down(operator_id)                   — R-08: the operator returns the whole fleet to its depots.

Enforced in code, not convention: nothing else in the backend writes `assets.zone_id`, `assets.status`,
`assets.lat` or `assets.lng`.
"""

from __future__ import annotations

from datetime import UTC, datetime

from psycopg.types.json import Jsonb

from ..db import connection
from .rules import R05PlanValidation, R08StandDown, get_rule

R05 = get_rule("R-05")
R08 = get_rule("R-08")
assert isinstance(R05, R05PlanValidation)
assert isinstance(R08, R08StandDown)


class PlanRejected(Exception):
    def __init__(self, errors: list[str], decision_id: int | None = None) -> None:
        super().__init__("; ".join(errors))
        self.errors = errors
        self.decision_id = decision_id


def fleet_snapshot(conn, asset_type: str | None = "pump_truck") -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, callsign, callsign_ar, type, capacity_m3_h, status, zone_id, depot_id, lat, lng FROM assets "
            + ("WHERE type = %s " if asset_type else "")
            + "ORDER BY id",
            (asset_type,) if asset_type else (),
        )
        return cur.fetchall()


def _zone_spots(cur, zone_id: str, n: int) -> list[tuple[float, float]]:
    """n (lat, lng) parking spots inside the zone, fanned out around its point-on-surface so markers never stack."""
    cur.execute(
        "SELECT ST_Y(ST_PointOnSurface(geom)) AS lat, ST_X(ST_PointOnSurface(geom)) AS lng FROM zones WHERE id = %s",
        (zone_id,),
    )
    row = cur.fetchone()
    lat0, lng0 = (row["lat"], row["lng"]) if row else (25.285, 51.531)
    return [(round(lat0 + ((k % 3) - 1) * 0.0012, 6), round(lng0 + ((k // 3) - 1) * 0.0014, 6)) for k in range(n)]


def depot_spot(depot: dict, k: int) -> tuple[float, float]:
    """Same fan-out the seed uses, so a stood-down fleet lands exactly where it started."""
    return round(depot["lat"] + ((k % 4) - 1.5) * 0.0009, 6), round(depot["lng"] + ((k // 4) - 1.0) * 0.0011, 6)


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
                spots = _zone_spots(cur, zone_id, n)
                for k in range(n):
                    if not pool:
                        break
                    a = pool.pop(0)
                    lat, lng = spots[k]
                    cur.execute(
                        "UPDATE assets SET zone_id = %s, status = %s, lat = %s, lng = %s WHERE id = %s",
                        (zone_id, status, lat, lng, a["id"]),
                    )
                    assignments.append(
                        {
                            "asset_id": a["id"],
                            "callsign": a["callsign"],
                            "callsign_ar": a["callsign_ar"],
                            "capacity_m3_h": a["capacity_m3_h"],
                            "zone_id": zone_id,
                            "status": status,
                            "lat": lat,
                            "lng": lng,
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


def stand_down(operator_id: str, tick: int | None = None) -> dict:
    """R-08: return every unit to its depot as idle. Logged with the operator id and the before/after fleet."""
    now = datetime.now(UTC)
    with connection() as conn:
        fleet = fleet_snapshot(conn, asset_type=None)
        errors = R08.validate(operator_id, len(fleet))
        if errors:
            raise PlanRejected(errors)
        with conn.cursor() as cur:
            cur.execute("SELECT id, lat, lng FROM depots")
            depots = {d["id"]: d for d in cur.fetchall()}
            per_depot: dict[str, int] = {}
            returned = 0
            for a in fleet:
                depot = depots.get(a["depot_id"] or "")
                if depot is None:
                    continue
                k = per_depot.get(depot["id"], 0)
                per_depot[depot["id"]] = k + 1
                lat, lng = depot_spot(depot, k)
                if a["status"] != "idle" or a["zone_id"] is not None or (a["lat"], a["lng"]) != (lat, lng):
                    returned += 1
                cur.execute(
                    "UPDATE assets SET zone_id = NULL, status = 'idle', lat = %s, lng = %s WHERE id = %s",
                    (lat, lng, a["id"]),
                )
            cur.execute(
                """INSERT INTO decision_log (ts, tick, decision_type, zone_id, rule_id, rule_version, inputs_json,
                                             output_json, proposed_by, approved_by, notified, source)
                   VALUES (%s,%s,'stand_down',NULL,%s,%s,%s,%s,'operator',%s,FALSE,'live') RETURNING id""",
                (
                    now,
                    tick,
                    R08.id,
                    R08.version,
                    Jsonb({"fleet_before": [{k: a[k] for k in ("id", "status", "zone_id")} for a in fleet]}),
                    Jsonb({"units_returned": returned, "fleet_size": len(fleet), "status": "idle"}),
                    operator_id,
                ),
            )
            decision_id = cur.fetchone()["id"]
        conn.commit()
    return {
        "decision_id": decision_id,
        "rule": f"{R08.id} v{R08.version}",
        "approved_by": operator_id,
        "units_returned": returned,
        "fleet_size": len(fleet),
        "ts": now.isoformat(),
    }
