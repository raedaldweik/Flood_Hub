from __future__ import annotations

from fastapi import APIRouter

from .. import __version__
from ..config import get_settings
from ..db import ping, query
from ..models import get_registry
from ..sim.physics import describe
from ..startup import STATE
from .replay import get_meta
from .schemas import Meta

router = APIRouter(prefix="/api", tags=["meta"])


def _db_ok() -> bool:
    # While the startup thread is still waiting for Postgres, don't burn a pool timeout per call.
    return ping() if STATE.phase not in ("starting", "waiting_db") else False


@router.get("/health")
def health() -> dict:
    """Liveness for Railway: 200 as soon as the port is open. `startup.phase` says whether the twin is ready."""
    return {"ok": True, "database": _db_ok(), "startup": STATE.snapshot()}


@router.get("/meta", response_model=Meta)
def meta() -> Meta:
    s = get_settings()
    db_ok = _db_ok()
    counts: dict[str, int] = {}
    replay = None
    if db_ok and STATE.ready:
        for t in ("zones", "alerts", "decision_log", "assets", "protocol_chunks", "flood_state"):
            counts[t] = query(f"SELECT count(*) AS n FROM {t}")[0]["n"]
        replay = get_meta()
    return Meta(
        app="PROJECT SADD", version=__version__, database_ok=db_ok, startup=STATE.snapshot(), replay=replay,
        counts=counts, physics=describe(), models=get_registry().info(),
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
