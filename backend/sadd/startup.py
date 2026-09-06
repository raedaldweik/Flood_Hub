"""Non-blocking startup.

The HTTP server binds its port immediately; waiting for Postgres and seeding the replay run in a
background thread and report their progress through /api/health and /api/meta. Every other /api
route answers 503 with the current phase until the twin is ready (see the gate in main.py).

Why: on Railway (or any PaaS) "Application failed to respond" means nothing was listening when the
edge forwarded the request. A first boot has to wait for private-network DNS, for a freshly
initialised Postgres, and then seed three days of replay from the Open-Meteo archive. None of that
should keep the port closed, and none of it should be invisible.
"""

from __future__ import annotations

import threading
import time
import traceback
from dataclasses import dataclass, field

from .db import ping, query_one

PHASES = ("starting", "waiting_db", "seeding", "ready", "seed_failed")


@dataclass
class StartupState:
    phase: str = "starting"
    detail: str = ""
    attempts: int = 0
    started_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    def set(self, phase: str, detail: str = "", attempts: int | None = None) -> None:
        if phase not in PHASES:
            raise ValueError(f"unknown startup phase {phase!r}")
        self.phase, self.detail, self.updated_at = phase, detail, time.time()
        if attempts is not None:
            self.attempts = attempts
        print(f"[sadd] startup: {phase}{' — ' + detail if detail else ''}", flush=True)

    @property
    def ready(self) -> bool:
        return self.phase == "ready"

    def snapshot(self) -> dict:
        return {
            "phase": self.phase,
            "detail": self.detail,
            "attempts": self.attempts,
            "seconds": round(time.time() - self.started_at, 1),
        }


STATE = StartupState()
_done = threading.Event()


def _already_seeded() -> bool:
    try:
        return query_one("SELECT 1 AS ok FROM replay_meta WHERE id = 1") is not None
    except Exception:
        return False  # schema not applied yet


def run_startup(seed: bool, db_label: str) -> None:
    """Body of the background thread. Never raises — the outcome lands in STATE."""
    try:
        attempt = 0
        while not ping():
            attempt += 1
            delay = min(10.0, 2.0 + attempt)  # 3, 4, … 10 s between attempts; keeps trying forever
            STATE.set("waiting_db", f"{db_label} not reachable yet — retrying in {delay:.0f}s", attempts=attempt)
            time.sleep(delay)
        STATE.attempts = attempt
        print(f"[sadd] database reachable: {db_label}", flush=True)
        if seed and not _already_seeded():
            STATE.set("seeding", "empty database — seeding the April 2024 replay (SEED_ON_STARTUP=true)")
            from .seed import run as run_seed

            run_seed()
        elif seed:
            print("[sadd] database already seeded", flush=True)
        STATE.set("ready")
    except Exception as exc:  # noqa: BLE001 — surface anything; /api/health keeps answering
        traceback.print_exc()
        STATE.set("seed_failed", f"{type(exc).__name__}: {exc}"[:300])
    finally:
        _done.set()


def start_background(seed: bool, db_label: str) -> threading.Thread:
    _done.clear()
    thread = threading.Thread(target=run_startup, args=(seed, db_label), name="sadd-startup", daemon=True)
    thread.start()
    return thread


def wait_until_done(timeout: float = 60.0) -> bool:
    """Block until the startup thread finishes (tests and scripts). True when the twin is ready."""
    _done.wait(timeout)
    return STATE.ready
