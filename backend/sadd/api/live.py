"""Live Doha weather from Open-Meteo (no key). Cached for ten minutes; never raises.

Also scores every zone with the physics baseline on the current intensity so the
Command Center can flip to LIVE and show today's (usually calm, green) city — Act 2.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime

import httpx
from fastapi import APIRouter

from ..config import get_settings
from ..db import query
from ..sim import ZoneParams
from ..sim.physics import band, exceedance_mm_h, risk_score
from .schemas import LiveWeather

router = APIRouter(prefix="/api/live", tags=["live"])

OPEN_METEO_FORECAST = "https://api.open-meteo.com/v1/forecast"
CACHE_TTL_S = 600
_cache: dict[str, object] = {"at": 0.0, "value": None}


def _fetch() -> LiveWeather:
    s = get_settings()
    try:
        r = httpx.get(
            OPEN_METEO_FORECAST,
            params={
                "latitude": s.open_meteo_lat, "longitude": s.open_meteo_lng,
                "current": (
                    "temperature_2m,relative_humidity_2m,precipitation,rain,weather_code,"
                    "wind_speed_10m,cloud_cover"
                ),
                "hourly": "precipitation,precipitation_probability",
                "past_hours": 24, "forecast_hours": 12, "timezone": "Asia/Qatar",
            },
            timeout=10,
        )
        r.raise_for_status()
        data = r.json()
        h = data["hourly"]
        hourly = [
            {"ts": t, "precipitation_mm": p or 0.0, "probability_pct": pr}
            for t, p, pr in zip(
                h["time"], h["precipitation"], h.get("precipitation_probability", [None] * len(h["time"])), strict=False
            )
        ]
        return LiveWeather(
            available=True, source="open-meteo-forecast", fetched_at=datetime.now(UTC),
            current=data.get("current"), hourly=hourly,
        )
    except Exception as exc:
        return LiveWeather(available=False, source="open-meteo-forecast", fetched_at=datetime.now(UTC),
                           error=f"{type(exc).__name__}: {exc}")


def get_live() -> LiveWeather:
    now = time.time()
    if _cache["value"] is None or now - float(_cache["at"]) > CACHE_TTL_S:  # type: ignore[arg-type]
        _cache["value"] = _fetch()
        _cache["at"] = now
    return _cache["value"]  # type: ignore[return-value]


@router.get("/weather", response_model=LiveWeather)
def live_weather() -> LiveWeather:
    return get_live()


@router.get("/state")
def live_state() -> dict:
    """Per-zone risk for the current live intensity (physics baseline, no accumulated depth)."""
    live = get_live()
    city_rain = float((live.current or {}).get("precipitation") or 0.0) if live.available else 0.0
    # 3h cumulative from the most recent three past hours in the hourly series.
    now_iso = (live.current or {}).get("time") if live.available else None
    past = [h for h in live.hourly if now_iso and h["ts"] <= now_iso][-3:]
    cum3 = float(sum(h["precipitation_mm"] for h in past))
    zones = query("SELECT * FROM zones")
    out = []
    for z in zones:
        p = ZoneParams(
            z["id"], z["imperviousness_pct"], z["drainage_capacity_mm_per_h"], z["elevation_m"], z["has_underpass"]
        )
        rain = city_rain * z["rain_factor"]
        risk = risk_score(p, rain, cum3 * z["rain_factor"], 0.0)
        out.append({
            "zone_id": z["id"], "rain_mm_h": round(rain, 2), "cum_3h_mm": round(cum3 * z["rain_factor"], 2),
            "exceedance_mm_h": round(exceedance_mm_h(p, rain), 2), "depth_cm": 0.0, "flooded": False,
            "risk": risk, "band": band(risk),
        })
    return {"available": live.available, "source": live.source, "fetched_at": live.fetched_at,
            "city_rain_mm_h": city_rain, "zones": out}
