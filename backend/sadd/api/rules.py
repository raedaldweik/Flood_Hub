from __future__ import annotations

from fastapi import APIRouter

from ..db import query
from ..rules import catalog

router = APIRouter(prefix="/api", tags=["governance"])


@router.get("/rules")
def rule_catalog() -> list[dict]:
    """Versioned, plain-language rule catalog — straight from the code that fires them."""
    return catalog()


@router.get("/decisions")
def decisions(limit: int = 500) -> list[dict]:
    return query("SELECT * FROM decision_log ORDER BY ts DESC, id DESC LIMIT %s", (limit,))
