"""Rafid endpoints: status, the SSE chat stream, and the human-in-the-loop plan approval."""

from __future__ import annotations

import json
from datetime import UTC, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..agent import plans, rafid
from ..agent.context import Turn
from ..db import query, query_one
from ..rules import PlanRejected, stand_down, validate_and_apply

router = APIRouter(prefix="/api/agent", tags=["agent"])
QATAR = ZoneInfo("Asia/Qatar")


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    session_id: str = Field(..., min_length=4, max_length=64)
    user_id: str = Field("operator", max_length=64)
    lang: str = Field("en", pattern="^(en|ar)$")
    tick: int = Field(0, ge=0)
    mode: str = Field("replay", pattern="^(replay|live)$")


class ApproveRequest(BaseModel):
    operator_id: str = Field("operator-01", min_length=2, max_length=64)


class ProposeRequest(BaseModel):
    objective: str = Field("minimise time-to-drain across flooded zones", min_length=3, max_length=300)
    storm_multiplier: float = Field(1.0, ge=0.25, le=3.0)
    tick: int | None = Field(None, ge=0)
    lang: str = Field("en", pattern="^(en|ar)$")


class StandDownRequest(BaseModel):
    operator_id: str = Field("operator-01", min_length=2, max_length=64)
    tick: int | None = Field(None, ge=0)


def _turn(req: ChatRequest) -> Turn:
    m = query_one("SELECT start_ts, tick_minutes, n_ticks FROM replay_meta WHERE id = 1")
    if m and req.mode == "replay":
        tick = min(req.tick, m["n_ticks"] - 1)
        ts = m["start_ts"] + timedelta(minutes=tick * m["tick_minutes"])
    else:
        from datetime import datetime

        tick, ts = req.tick, datetime.now(UTC)
    return Turn(
        tick=tick,
        ts_iso=ts.astimezone(UTC).isoformat().replace("+00:00", "Z"),
        ts_local=ts.astimezone(QATAR).strftime("%a %d %b %Y %H:%M") + " AST",
        lang=req.lang,
        mode=req.mode,
    )


@router.get("/status")
def status() -> dict:
    return rafid.status()


@router.post("/chat")
async def chat(req: ChatRequest) -> StreamingResponse:
    """Server-sent events: `data: {json}` lines — tool_call, tool_result, citations, plan, draft, text, error, done."""
    turn = _turn(req)

    async def gen():
        async for ev in rafid.stream(req.session_id, req.user_id, req.message, turn):
            yield f"data: {json.dumps(ev, ensure_ascii=False, default=str)}\n\n"

    return StreamingResponse(
        gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )


@router.post("/plans/propose")
def propose_plan(req: ProposeRequest) -> dict:
    """The Simulation Lab's "Ask Rafid to optimise": Rafid's planner tool called directly (the deterministic
    greedy optimiser over the what-if engine), so the plan card appears in well under a second and even when
    Gemini is offline. Same plan object, same R-05 gate, same APPROVE click — the agent never applies it."""
    return plans.propose(req.objective, req.storm_multiplier, req.tick, req.lang)


@router.post("/fleet/stand-down")
def fleet_stand_down(req: StandDownRequest) -> dict:
    """R-08: the operator returns every unit to its depot (idle). Logged with the operator id."""
    try:
        return stand_down(req.operator_id, tick=req.tick)
    except PlanRejected as exc:
        raise HTTPException(422, {"errors": exc.errors}) from exc


@router.get("/plans/{plan_id}")
def get_plan(plan_id: str) -> dict:
    p = plans.get(plan_id)
    if not p:
        raise HTTPException(404, "unknown plan")
    return p


@router.post("/plans/{plan_id}/approve")
def approve_plan(plan_id: str, req: ApproveRequest) -> dict:
    """The human-in-the-loop click. R-05 validates; only then do trucks move; everything is logged."""
    p = plans.get(plan_id)
    if not p:
        raise HTTPException(404, "unknown plan")
    if p.get("status") == "approved":
        return {"plan_id": plan_id, "status": "approved", "result": p.get("result")}
    tick = p.get("tick")
    rows = query(
        "SELECT z.id, f.risk_score FROM zones z LEFT JOIN flood_state f ON f.zone_id = z.id AND f.tick = %s", (tick,)
    )
    # Eligibility for R-05: the zone's peak risk under the plan's storm (what the proposal was built on),
    # or an open pre-position recommendation.
    peak = {z["zone_id"]: z["peak_band"] for z in p.get("zones", [])}
    rec = {r["zone_id"] for r in query("SELECT DISTINCT zone_id FROM decision_log WHERE rule_id = 'R-04'")}
    ctx = {
        r["id"]: {
            "risk": max(
                float(r["risk_score"] or 0.0),
                {"yellow": 40.0, "orange": 60.0, "red": 80.0}.get(peak.get(r["id"], ""), 0.0),
            ),
            "recommended": r["id"] in rec,
        }
        for r in rows
    }
    try:
        result = validate_and_apply(p, req.operator_id, ctx, tick=tick)
    except PlanRejected as exc:
        plans.mark(plan_id, "rejected", {"errors": exc.errors, "decision_id": exc.decision_id})
        raise HTTPException(422, {"errors": exc.errors, "decision_id": exc.decision_id}) from exc
    plans.mark(plan_id, "approved", result)
    return {"plan_id": plan_id, "status": "approved", "result": result}
