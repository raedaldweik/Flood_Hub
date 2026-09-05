"""FastAPI entrypoint. `uvicorn sadd.main:app --reload --port 8000`.

In production (Dockerfile / Railway) this same process also serves the Next.js static export
from FRONTEND_DIST, so the whole demo is one service behind one URL.
"""

from __future__ import annotations

import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import __version__
from .api import agent, alerts, assets, live, meta, replay, rules, zones
from .config import REPO_ROOT, get_settings
from .db import close_pool, ping, query_one


def _wait_for_db(attempts: int = 12, delay_s: float = 5.0) -> bool:
    """Private-network DNS and a freshly started Postgres can lag the app by a few seconds."""
    for i in range(attempts):
        if ping():
            return True
        print(f"[sadd] database not reachable yet ({i + 1}/{attempts}) — retrying in {delay_s:.0f}s", flush=True)
        time.sleep(delay_s)
    return False


def _seed_if_empty() -> None:
    try:
        seeded = query_one("SELECT 1 AS ok FROM replay_meta WHERE id = 1")
    except Exception:
        seeded = None  # schema not applied yet
    if seeded:
        print("[sadd] database already seeded", flush=True)
        return
    print("[sadd] empty database — running seed (SEED_ON_STARTUP=true)", flush=True)
    from .seed import run as run_seed

    run_seed()


@asynccontextmanager
async def lifespan(_: FastAPI):
    s = get_settings()
    ok = _wait_for_db() if s.seed_on_startup else ping()
    print(f"[sadd] database {'reachable' if ok else 'UNREACHABLE — start it with `make db`'}", flush=True)
    if ok and s.seed_on_startup:
        _seed_if_empty()
    yield
    close_pool()


app = FastAPI(
    title="PROJECT SADD — backend",
    version=__version__,
    description="Urban flood command & preparedness twin (fictional Doha Flood Operations Center).",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
)
for r in (
    meta.router, zones.router, replay.router, alerts.router, assets.router, rules.router, live.router, agent.router
):
    app.include_router(r)

# Static frontend (production). Mounted LAST so /api/* routes win; missing dir = API-only mode.
_dist = get_settings().frontend_dist or str(REPO_ROOT / "frontend" / "out")
FRONTEND_DIST = Path(_dist)
if FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
    print(f"[sadd] serving frontend from {FRONTEND_DIST}", flush=True)
else:

    @app.get("/")
    def root() -> dict:
        return {"app": "PROJECT SADD", "docs": "/docs", "health": "/api/health"}
