"""Model status + on-demand scoring (the Rafid tool `score_zone` calls this)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..db import query_one
from ..models import get_registry
from ..sim.physics import ZoneParams, band
from .replay import get_meta

router = APIRouter(prefix="/api/models", tags=["models"])


class ScoreRequest(BaseModel):
    zone_id: str
    rain_multiplier: float = Field(1.0, ge=0.0, le=5.0)
    tick: int | None = Field(None, ge=0, description="replay tick to take rain from (default: storm peak)")
    rain_mm_h: float | None = Field(None, ge=0, description="override: rain intensity now")
    cum_3h_mm: float | None = Field(None, ge=0, description="override: 3-hour accumulation")


def zone_params(z: dict) -> ZoneParams:
    return ZoneParams(
        zone_id=z["id"],
        imperviousness_pct=z["imperviousness_pct"],
        drainage_capacity_mm_h=z["drainage_capacity_mm_per_h"],
        elevation_m=z["elevation_m"],
        has_underpass=z["has_underpass"],
        area_km2=z["area_km2"],
        population=z["population"],
        criticality=z["criticality"],
    )


@router.get("")
def models_info() -> dict:
    """Which models are loaded, their holdout metrics and feature importances (or the physics fallback)."""
    return get_registry().info()


@router.post("/score")
def score(req: ScoreRequest) -> dict:
    """Score one zone under given (or scaled replay) rain, with per-feature contributions."""
    z = query_one("SELECT * FROM zones WHERE id = %s", (req.zone_id,))
    if not z:
        raise HTTPException(404, "unknown zone")
    p = zone_params(z)
    rain, cum3, depth, basis = req.rain_mm_h, req.cum_3h_mm, 0.0, "override"
    if rain is None or cum3 is None:
        m = get_meta()
        if not m:
            raise HTTPException(409, "replay not seeded — pass rain_mm_h and cum_3h_mm explicitly")
        tick = req.tick if req.tick is not None else m.peak_tick
        st = query_one("SELECT * FROM flood_state WHERE zone_id = %s AND tick = %s", (req.zone_id, tick))
        if not st:
            raise HTTPException(404, "no state for tick")
        rain = st["rain_mm_h"] * req.rain_multiplier if rain is None else rain
        cum3 = st["cum_3h_mm"] * req.rain_multiplier if cum3 is None else cum3
        depth = st["water_depth_cm"] * req.rain_multiplier
        basis = f"replay tick {tick} × {req.rain_multiplier:g}"
    out = get_registry().risk_contributions(p, rain, cum3, depth)
    return {
        "zone_id": p.zone_id,
        "name_en": z["name_en"],
        "name_ar": z["name_ar"],
        "risk": out["risk"],
        "band": band(out["risk"]),
        "source": out["source"],
        "baseline": out["baseline"],
        "contributions": out["contributions"],
        "inputs": {
            "rain_mm_h": round(rain, 2),
            "cum_3h_mm": round(cum3, 2),
            "drainage_capacity_mm_h": p.drainage_capacity_mm_h,
            "imperviousness_pct": p.imperviousness_pct,
            "elevation_m": p.elevation_m,
            "has_underpass": p.has_underpass,
            "basis": basis,
        },
    }
