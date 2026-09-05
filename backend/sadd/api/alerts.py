from __future__ import annotations

from fastapi import APIRouter, Query

from ..db import query
from .schemas import Alert

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


@router.get("", response_model=list[Alert])
def list_alerts(
    source: str = Query("replay_2024"),
    until_tick: int | None = Query(None, description="only alerts raised at or before this tick"),
    limit: int = Query(500, le=2000),
) -> list[Alert]:
    """Alerts newest-first. Every row was written by the rules engine — never by an LLM."""
    sql = "SELECT * FROM alerts WHERE source = %s"
    params: list = [source]
    if until_tick is not None:
        sql += " AND tick <= %s"
        params.append(until_tick)
    sql += " ORDER BY ts DESC, id DESC LIMIT %s"
    params.append(limit)
    return [Alert(**r) for r in query(sql, params)]
