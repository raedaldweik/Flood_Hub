"""FastAPI entrypoint. `uvicorn sadd.main:app --reload --port 8000`."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .api import agent, alerts, assets, live, meta, replay, rules, zones
from .config import get_settings
from .db import close_pool, ping


@asynccontextmanager
async def lifespan(_: FastAPI):
    ok = ping()
    print(f"[sadd] database {'reachable' if ok else 'UNREACHABLE — start it with `make db`'}", flush=True)
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


@app.get("/")
def root() -> dict:
    return {"app": "PROJECT SADD", "docs": "/docs", "health": "/api/health"}
