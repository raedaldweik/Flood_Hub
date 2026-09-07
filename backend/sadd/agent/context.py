"""Per-turn context the local tools read (the operator's replay time, language, mode)."""

from __future__ import annotations

from contextvars import ContextVar
from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class Turn:
    tick: int
    ts_iso: str  # RFC 3339 UTC of the replay tick (or now, in live mode)
    ts_local: str  # human-readable Doha time
    lang: str = "en"
    mode: str = "replay"

    def as_dict(self) -> dict:
        return asdict(self)


TURN: ContextVar[Turn | None] = ContextVar("sadd_turn", default=None)


def turn() -> Turn:
    return TURN.get() or Turn(0, "", "", "en", "replay")
