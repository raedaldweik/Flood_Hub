"""Model registry: loads the joblib artifacts once and serves both models.

Honesty rule: when the artifacts are missing (fresh clone before `make train`) every call falls
back to the transparent physics baseline and says so through `source`, so nothing in the UI is
ever mislabelled as ML.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path

import numpy as np

from ..config import ARTIFACTS_DIR
from ..sim import physics
from ..sim.physics import ZoneParams
from .features import (
    DRAIN_FEATURES,
    RISK_FEATURE_DRIVER,
    RISK_FEATURES,
    TTD_CAP_H,
    drain_features,
    risk_features,
    ttd_truth_hours,
)


class Registry:
    def __init__(self, artifacts_dir: Path = ARTIFACTS_DIR) -> None:
        self.dir = Path(artifacts_dir)
        self.risk: dict | None = None
        self.drain: dict | None = None
        self.error: str | None = None
        self._loaded = False
        self._lock = threading.Lock()

    # ── lifecycle ────────────────────────────────────────────────────────────
    def load(self) -> Registry:
        with self._lock:
            if self._loaded:
                return self
            self._loaded = True
            try:
                import joblib

                self.risk = joblib.load(self.dir / "risk_nowcast.joblib")
                self.drain = joblib.load(self.dir / "time_to_drain.joblib")
                print(f"[models] loaded {self.risk['version']} + {self.drain['version']} from {self.dir}", flush=True)
            except Exception as exc:  # noqa: BLE001 — degrade to physics, never crash the API
                self.risk = self.drain = None
                self.error = f"{type(exc).__name__}: {exc}"
                print(f"[models] artifacts not loaded ({self.error}) — physics_v0 baseline in use", flush=True)
        return self

    @property
    def available(self) -> bool:
        return self.load().risk is not None and self.drain is not None

    @property
    def risk_source(self) -> str:
        return self.risk["version"] if self.available and self.risk else physics.RISK_SOURCE

    # ── risk nowcast ─────────────────────────────────────────────────────────
    def risk_score(self, p: ZoneParams, rain_mm_h: float, cum_3h_mm: float, depth_cm: float = 0.0) -> float:
        """Same signature as physics.risk_score so the replay can swap scorers; the model ignores depth."""
        if not self.available or self.risk is None:
            return physics.risk_score(p, rain_mm_h, cum_3h_mm, depth_cm)
        x = np.asarray([risk_features(p, rain_mm_h, cum_3h_mm)])
        return round(float(np.clip(self.risk["model"].predict(x)[0], 0.0, 100.0)), 1)

    def risk_scores(self, rows: np.ndarray) -> np.ndarray:
        if not self.available or self.risk is None:
            raise RuntimeError("risk model not loaded")
        return np.clip(self.risk["model"].predict(rows), 0.0, 100.0)

    def risk_contributions(self, p: ZoneParams, rain_mm_h: float, cum_3h_mm: float, depth_cm: float = 0.0) -> dict:
        """Why this score: TreeSHAP per-feature contributions (points), plus the model's baseline.

        Falls back to the physics driver decomposition when the model is not loaded.
        """
        if not self.available or self.risk is None:
            parts = physics.explain_risk(p, rain_mm_h, cum_3h_mm, depth_cm)
            return {
                "source": physics.RISK_SOURCE,
                "risk": physics.risk_score(p, rain_mm_h, cum_3h_mm, depth_cm),
                "baseline": 0.0,
                "contributions": [{"driver": d, "points": round(v, 1)} for d, v in parts],
            }
        import xgboost as xgb

        x = np.asarray([risk_features(p, rain_mm_h, cum_3h_mm)])
        booster = self.risk["model"].get_booster()
        contrib = booster.predict(xgb.DMatrix(x, feature_names=list(RISK_FEATURES)), pred_contribs=True)[0]
        risk = float(np.clip(contrib.sum(), 0.0, 100.0))
        return {
            "source": self.risk["version"],
            "risk": round(risk, 1),
            "baseline": round(float(contrib[-1]), 1),
            "contributions": [
                {"driver": RISK_FEATURE_DRIVER[f], "points": round(float(v), 1)}
                for f, v in zip(RISK_FEATURES, contrib[:-1], strict=True)
            ],
        }

    # ── time to drain ────────────────────────────────────────────────────────
    def time_to_drain(self, volume_m3: float, pump_m3_h: float, drainage_m3_h: float, inflow_m3_h: float) -> float:
        if volume_m3 <= 0:
            return 0.0
        if not self.available or self.drain is None:
            return round(ttd_truth_hours(volume_m3, pump_m3_h, drainage_m3_h, inflow_m3_h), 2)
        x = np.asarray([drain_features(volume_m3, pump_m3_h, drainage_m3_h, inflow_m3_h)])
        hours = float(np.expm1(self.drain["model"].predict(x)[0]))
        return round(float(np.clip(hours, 0.0, TTD_CAP_H)), 2)

    # ── status ───────────────────────────────────────────────────────────────
    def info(self) -> dict:
        self.load()
        meta_path = self.dir / "metadata.json"
        meta = json.loads(meta_path.read_text()) if meta_path.is_file() else {}
        return {
            "available": self.available,
            "error": self.error,
            "artifacts_dir": str(self.dir),
            "risk": {
                "source": self.risk_source,
                "features": list(RISK_FEATURES),
                **({k: self.risk[k] for k in ("metrics", "importances", "n_train", "trained_at")} if self.risk else {}),
                "generator": physics.RISK_SOURCE,
                "fallback": physics.RISK_SOURCE,
            },
            "time_to_drain": {
                "source": self.drain["version"] if self.drain else "mass_balance",
                "features": list(DRAIN_FEATURES),
                **(
                    {k: self.drain[k] for k in ("metrics", "importances", "n_train", "trained_at")}
                    if self.drain
                    else {}
                ),
                "formula": "hours ≈ volume ÷ (pumps + local drainage − inflow), capped at 48 h",
                "cap_h": TTD_CAP_H,
            },
            "training": {"elapsed_s": meta.get("elapsed_s")},
            "gcp": "BigQuery ML: CREATE MODEL over the same generated tables, scored via the BigQuery MCP server",
        }


_registry: Registry | None = None


def get_registry() -> Registry:
    global _registry
    if _registry is None:
        _registry = Registry()
    return _registry
