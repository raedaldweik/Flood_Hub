"""Train both models in well under a minute: `make train` / `python -m sadd.models.train`.

Training data is generated, not measured — deliberately. The generator is the documented
physics_v0 baseline plus noise, so the models learn real monotonic relationships (more rain,
less drainage → more risk) rather than fitting a fictional dataset, and their feature
importances can be defended in Q&A. On GCP both become BigQuery ML models: CREATE MODEL over
the same generated tables, scored through the managed BigQuery MCP server.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split
from xgboost import XGBRegressor

from ..config import ARTIFACTS_DIR
from ..sim import physics
from ..sim.physics import ZoneParams
from .features import DRAIN_FEATURES, RISK_FEATURES, ttd_truth_hours

RISK_VERSION = "xgb_nowcast_v1"
DRAIN_VERSION = "gbr_ttd_v1"


def log(msg: str) -> None:
    print(f"[train] {msg}", flush=True)


def generate_risk_dataset(n: int = 6000, seed: int = 7) -> tuple[np.ndarray, np.ndarray]:
    """Zones drawn around Doha-like attributes; rain drawn from calm/moderate/extreme regimes."""
    rng = np.random.default_rng(seed)
    imperv = rng.uniform(45, 96, n)
    drainage = rng.uniform(8, 36, n)
    elevation = rng.uniform(1, 40, n)
    underpass = rng.random(n) < 0.3
    regime = rng.choice(3, n, p=[0.4, 0.4, 0.2])
    rain = np.where(
        regime == 0, rng.uniform(0, 8, n), np.where(regime == 1, rng.uniform(5, 26, n), rng.uniform(20, 65, n))
    )
    cum3 = np.clip(rain * rng.uniform(0.8, 3.0, n), 0, 160)

    X = np.column_stack([rain, cum3, drainage, imperv, elevation, underpass.astype(float)])
    y = np.empty(n)
    for i in range(n):
        p = ZoneParams("gen", float(imperv[i]), float(drainage[i]), float(elevation[i]), bool(underpass[i]))
        # Quasi-steady standing water for the label: what the last three hours left behind.
        surface = max(0.0, cum3[i] * imperv[i] / 100.0 - drainage[i] * 3.0 * rng.uniform(0.5, 1.0))
        depth = surface * p.concentration / 10.0 * rng.uniform(0.7, 1.3)
        y[i] = physics.risk_score(p, float(rain[i]), float(cum3[i]), depth) + rng.normal(0, 2.5)
    return X, np.clip(y, 0, 100)


def generate_drain_dataset(n: int = 5000, seed: int = 11) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    volume = np.exp(rng.uniform(np.log(100), np.log(60_000), n))
    pumps = rng.integers(0, 9, n) * rng.uniform(150, 400, n)
    drainage = rng.uniform(20, 1500, n)
    inflow = np.where(rng.random(n) < 0.6, 0.0, rng.uniform(0, 3000, n))
    X = np.column_stack([volume, pumps, drainage, inflow, pumps + drainage - inflow])
    y = np.array([ttd_truth_hours(*row[:4]) for row in X]) * rng.uniform(0.92, 1.08, n)
    return X, np.clip(y, 0, 48)


def train_risk(seed: int = 7) -> dict:
    X, y = generate_risk_dataset(seed=seed)
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, random_state=seed)
    model = XGBRegressor(
        n_estimators=400,
        max_depth=4,
        learning_rate=0.06,
        subsample=0.9,
        colsample_bytree=0.9,
        objective="reg:squarederror",
        random_state=seed,
        n_jobs=2,
    )
    model.fit(Xtr, ytr)
    model.get_booster().feature_names = list(RISK_FEATURES)
    pred = model.predict(Xte)
    gain = model.get_booster().get_score(importance_type="gain")
    total = sum(gain.values()) or 1.0
    return {
        "model": model,
        "version": RISK_VERSION,
        "features": list(RISK_FEATURES),
        "metrics": {"r2": round(float(r2_score(yte, pred)), 4), "mae": round(float(mean_absolute_error(yte, pred)), 3)},
        "importances": {f: round(gain.get(f, 0.0) / total, 4) for f in RISK_FEATURES},
        "n_train": int(len(ytr)),
        "generator": physics.RISK_SOURCE,
        "trained_at": datetime.now(UTC).isoformat(timespec="seconds"),
    }


def train_drain(seed: int = 11) -> dict:
    X, y = generate_drain_dataset(seed=seed)
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, random_state=seed)
    model = GradientBoostingRegressor(n_estimators=300, max_depth=3, learning_rate=0.05, random_state=seed)
    model.fit(Xtr, np.log1p(ytr))
    pred = np.expm1(model.predict(Xte))
    imp = model.feature_importances_
    return {
        "model": model,
        "version": DRAIN_VERSION,
        "features": list(DRAIN_FEATURES),
        "metrics": {
            "r2": round(float(r2_score(yte, pred)), 4),
            "mae_h": round(float(mean_absolute_error(yte, pred)), 3),
        },
        "importances": {f: round(float(v), 4) for f, v in zip(DRAIN_FEATURES, imp, strict=True)},
        "n_train": int(len(ytr)),
        "generator": "mass_balance",
        "trained_at": datetime.now(UTC).isoformat(timespec="seconds"),
    }


def run(out_dir: Path = ARTIFACTS_DIR) -> dict:
    t0 = time.time()
    out_dir.mkdir(parents=True, exist_ok=True)
    risk = train_risk()
    joblib.dump(risk, out_dir / "risk_nowcast.joblib")
    log(f"{risk['version']}: R² {risk['metrics']['r2']} · MAE {risk['metrics']['mae']} pts")
    log(f"  importances {risk['importances']}")
    drain = train_drain()
    joblib.dump(drain, out_dir / "time_to_drain.joblib")
    log(f"{drain['version']}: R² {drain['metrics']['r2']} · MAE {drain['metrics']['mae_h']} h")
    log(f"  importances {drain['importances']}")
    meta = {
        "risk": {k: v for k, v in risk.items() if k != "model"},
        "time_to_drain": {k: v for k, v in drain.items() if k != "model"},
        "elapsed_s": round(time.time() - t0, 1),
    }
    (out_dir / "metadata.json").write_text(json.dumps(meta, indent=2))
    log(f"done in {meta['elapsed_s']}s → {out_dir}")
    return meta


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Train the risk nowcast and time-to-drain models")
    ap.add_argument("--out", type=Path, default=ARTIFACTS_DIR)
    sys.exit(0 if run(ap.parse_args().out) else 1)
