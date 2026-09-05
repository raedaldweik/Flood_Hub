from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..db import query, query_one
from .schemas import KpiSeries, ReplayMeta, Timeline, ZoneSeries

router = APIRouter(prefix="/api/replay", tags=["replay"])


def get_meta() -> ReplayMeta | None:
    row = query_one("SELECT * FROM replay_meta WHERE id = 1")
    return ReplayMeta(**row) if row else None


@router.get("/meta", response_model=ReplayMeta)
def replay_meta() -> ReplayMeta:
    m = get_meta()
    if not m:
        raise HTTPException(404, "replay not seeded — run `make seed`")
    return m


@router.get("/timeline", response_model=Timeline)
def timeline() -> Timeline:
    """The whole precomputed April-2024 replay in one compact payload (~200 KB).

    The frontend scrubs and plays entirely client-side, so 20× playback never touches the
    network — CLAUDE.md §10: "smoothness beats realism".
    """
    m = get_meta()
    if not m:
        raise HTTPException(404, "replay not seeded — run `make seed`")
    ticks = query("SELECT tick, ts, city_rain_mm_h FROM replay_ticks ORDER BY tick")
    states = query(
        "SELECT zone_id, tick, rain_mm_h, cum_3h_mm, exceedance_mm_h, water_depth_cm, flooded, risk_score "
        "FROM flood_state ORDER BY zone_id, tick"
    )
    zones: dict[str, ZoneSeries] = {}
    for r in states:
        z = zones.get(r["zone_id"])
        if z is None:
            z = zones[r["zone_id"]] = ZoneSeries(rain=[], cum_3h=[], exceedance=[], depth_cm=[], risk=[], flooded=[])
        z.rain.append(r["rain_mm_h"])
        z.cum_3h.append(r["cum_3h_mm"])
        z.exceedance.append(r["exceedance_mm_h"])
        z.depth_cm.append(r["water_depth_cm"])
        z.risk.append(r["risk_score"])
        z.flooded.append(r["flooded"])
    k = query("SELECT * FROM replay_kpis ORDER BY tick")
    return Timeline(
        meta=m,
        ts=[t["ts"] for t in ticks],
        city_rain=[t["city_rain_mm_h"] for t in ticks],
        zones=zones,
        kpis=KpiSeries(
            active_alerts=[r["active_alerts"] for r in k],
            zones_at_risk=[r["zones_at_risk"] for r in k],
            zones_flooded=[r["zones_flooded"] for r in k],
            assets_deployed=[r["assets_deployed"] for r in k],
            population_affected=[r["population_affected"] for r in k],
            lead_time_min=[r["lead_time_min"] for r in k],
        ),
    )
