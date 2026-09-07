from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Query

from ..db import query, query_one
from ..models import get_registry
from ..sim import ZoneParams
from ..sim.physics import band
from .schemas import Contribution, ZoneCollection, ZoneExplanation, ZoneFeature, ZoneProperties

router = APIRouter(prefix="/api/zones", tags=["zones"])

ZONE_SQL = """
SELECT id, name_en, name_ar, area_km2, elevation_m, imperviousness_pct, drainage_capacity_mm_per_h,
       population, has_underpass, criticality, rain_factor, notes,
       ST_AsGeoJSON(geom, 6) AS geom_json,
       ST_X(ST_Centroid(geom)) AS c_lng, ST_Y(ST_Centroid(geom)) AS c_lat
FROM zones ORDER BY criticality DESC, id
"""


def _feature(r: dict) -> ZoneFeature:
    props = {k: r[k] for k in ZoneProperties.model_fields if k in r}
    props["centroid"] = [round(r["c_lng"], 6), round(r["c_lat"], 6)]
    return ZoneFeature(geometry=json.loads(r["geom_json"]), properties=ZoneProperties(**props))


@router.get("", response_model=ZoneCollection)
def list_zones() -> ZoneCollection:
    return ZoneCollection(features=[_feature(r) for r in query(ZONE_SQL)])


@router.get("/{zone_id}/explain", response_model=ZoneExplanation)
def explain_zone(zone_id: str, tick: int = Query(..., ge=0)) -> ZoneExplanation:
    """Why is this zone this colour at this tick — driver-by-driver, from the physics baseline."""
    z = query_one("SELECT * FROM zones WHERE id = %s", (zone_id,))
    if not z:
        raise HTTPException(404, "unknown zone")
    st = query_one("SELECT * FROM flood_state WHERE zone_id = %s AND tick = %s", (zone_id, tick))
    if not st:
        raise HTTPException(404, "no state for tick")
    p = ZoneParams(
        zone_id=z["id"], imperviousness_pct=z["imperviousness_pct"],
        drainage_capacity_mm_h=z["drainage_capacity_mm_per_h"], elevation_m=z["elevation_m"],
        has_underpass=z["has_underpass"],
    )
    out = get_registry().risk_contributions(p, st["rain_mm_h"], st["cum_3h_mm"], st["water_depth_cm"])
    return ZoneExplanation(
        zone_id=zone_id, tick=tick, risk=st["risk_score"], band=band(st["risk_score"]),
        source=out["source"], model_risk=out["risk"], baseline=out["baseline"],
        contributions=[Contribution(**c) for c in out["contributions"]],
        inputs={
            "rain_mm_h": st["rain_mm_h"], "cum_3h_mm": st["cum_3h_mm"], "exceedance_mm_h": st["exceedance_mm_h"],
            "water_depth_cm": st["water_depth_cm"], "flooded": st["flooded"],
            "drainage_capacity_mm_per_h": z["drainage_capacity_mm_per_h"],
            "imperviousness_pct": z["imperviousness_pct"], "elevation_m": z["elevation_m"],
            "has_underpass": z["has_underpass"],
        },
    )
