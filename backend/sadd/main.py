"""FastAPI entrypoint. `uvicorn sadd.main:app --reload --port 8000`.

In production (Dockerfile / Railway) this same process also serves the Next.js static export
from FRONTEND_DIST, so the whole demo is one service behind one URL.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .api import agent, alerts, assets, buildings, live, meta, replay, rules, zones
from .config import REPO_ROOT, get_settings
from .db import close_pool
from .startup import STATE, start_background


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Bind first, prepare in the background: the port is open from the first second and
    # /api/health reports whether we are waiting for Postgres, seeding, or ready (see startup.py).
    s = get_settings()
    start_background(seed=s.seed_on_startup, db_label=s.database_url.split("@")[-1])
    yield
    close_pool()


app = FastAPI(
    title="PROJECT SADD — backend",
    version=__version__,
    description="Urban flood command & preparedness twin (fictional Doha Flood Operations Center).",
    lifespan=lifespan,
)
UNGATED = {"/api/health", "/api/meta", "/api/agent/status", "/api/buildings"}  # none of these need the database


@app.middleware("http")
async def startup_gate(request: Request, call_next):
    """Until the twin is ready, data routes answer 503 + the startup phase instead of a stack trace."""
    path = request.url.path
    if path.startswith("/api/") and path not in UNGATED and not STATE.ready:
        return JSONResponse(
            {"detail": "starting", "startup": STATE.snapshot()}, status_code=503, headers={"Retry-After": "3"}
        )
    return await call_next(request)


# Added after the gate so CORS headers wrap its 503s too (last added = outermost).
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
)
for r in (
    meta.router, zones.router, replay.router, alerts.router, assets.router, rules.router, live.router, agent.router,
    buildings.router,
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
