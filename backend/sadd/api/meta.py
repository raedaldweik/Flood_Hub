from __future__ import annotations

from fastapi import APIRouter

from .. import __version__
from ..config import get_settings
from ..db import ping, query
from ..sim.physics import describe
from .replay import get_meta
from .schemas import Meta

router = APIRouter(prefix="/api", tags=["meta"])


@router.get("/health")
def health() -> dict:
    return {"ok": True, "database": ping()}


@router.get("/meta", response_model=Meta)
def meta() -> Meta:
    s = get_settings()
    db_ok = ping()
    counts: dict[str, int] = {}
    replay = None
    if db_ok:
        for t in ("zones", "alerts", "decision_log", "assets", "protocol_chunks", "flood_state"):
            counts[t] = query(f"SELECT count(*) AS n FROM {t}")[0]["n"]
        replay = get_meta()
    return Meta(
        app="PROJECT SADD", version=__version__, database_ok=db_ok, replay=replay, counts=counts,
        physics=describe(),
        features={
            "gemini": bool(s.gemini_api_key),
            "flood_mcp_live": s.flood_mcp_backend == "live",
        },
        disclaimers={
            "en": (
                "Fictional operations center. Replay uses public reanalysis or a synthetic curve; zone attributes "
                "are synthetic. Historical figures approx., based on public reports."
            ),
            "ar": (
                "مركز عمليات خيالي. تستخدم الإعادة بيانات إعادة تحليل عامة أو منحنى اصطناعياً؛ "
                "خصائص المناطق اصطناعية. الأرقام التاريخية تقريبية بناءً على تقارير عامة."
            ),
        },
    )
