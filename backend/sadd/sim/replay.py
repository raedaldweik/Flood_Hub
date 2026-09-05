"""Replay timeline precompute: hourly city rain → per-zone, per-tick state.

Pipeline (run once by `sadd.seed`):
  1. `distribute_rain`   city hourly mm → per-zone hourly intensity (spatial factor × smooth noise)
  2. `interpolate_ticks` hourly → N-minute ticks (piecewise-linear between hour midpoints)
  3. `build_timeline`    run the physics_v0 mass balance tick by tick
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

import numpy as np

from . import physics
from .physics import ZoneParams, ZoneState


@dataclass(frozen=True)
class TickState:
    tick: int
    ts: datetime
    zone_id: str
    rain_mm_h: float
    cum_3h_mm: float
    exceedance_mm_h: float
    depth_cm: float
    flooded: bool
    risk: float


def distribute_rain(
    city_hourly_mm: list[float],
    zone_factors: dict[str, float],
    seed: int = 42,
    noise_sigma: float = 0.12,
    noise_rho: float = 0.7,
) -> dict[str, list[float]]:
    """Spatially vary the city curve per zone.

    factor  — coastal vs inland multiplier from the zone file (e.g. 1.15 for West Bay)
    noise   — AR(1) multiplicative noise so cells differ hour to hour but move smoothly,
              clipped to [0.7, 1.3]. Deterministic (seeded) so re-seeding is reproducible.
    """
    rng = np.random.default_rng(seed)
    out: dict[str, list[float]] = {}
    n = len(city_hourly_mm)
    for zone_id, factor in zone_factors.items():
        eps = 0.0
        series: list[float] = []
        for h in range(n):
            eps = noise_rho * eps + rng.normal(0.0, noise_sigma) * (1 - noise_rho**2) ** 0.5
            mult = float(np.clip(1.0 + eps, 0.7, 1.3))
            series.append(round(max(0.0, city_hourly_mm[h] * factor * mult), 3))
        out[zone_id] = series
    return out


def interpolate_ticks(hourly: list[float], tick_minutes: int) -> list[float]:
    """Hourly totals (mm, for the hour starting at index h) → intensity (mm/h) per tick.

    Hour h's value is placed at the hour midpoint and sampled linearly at each tick start, which avoids the
    staircase look at 20× playback while preserving the hourly shape.
    """
    per_hour = 60 // tick_minutes
    n_ticks = len(hourly) * per_hour
    mids = np.arange(len(hourly)) + 0.5
    xs = np.arange(n_ticks) / per_hour  # tick i starts at i/per_hour hours
    return [round(float(v), 3) for v in np.interp(xs, mids, hourly)]


def build_timeline(
    start_ts: datetime,
    tick_minutes: int,
    zone_params: list[ZoneParams],
    zone_tick_rain: dict[str, list[float]],
) -> list[TickState]:
    dt_h = tick_minutes / 60.0
    window_3h = int(180 / tick_minutes)
    states: list[TickState] = []
    for p in zone_params:
        rain = zone_tick_rain[p.zone_id]
        s = ZoneState()
        for i, r in enumerate(rain):
            s = physics.step(p, s, r, dt_h)
            depth = s.depth_cm(p)
            cum3 = float(sum(rain[max(0, i - window_3h + 1) : i + 1]) * dt_h)
            states.append(
                TickState(
                    tick=i,
                    ts=start_ts + timedelta(minutes=i * tick_minutes),
                    zone_id=p.zone_id,
                    rain_mm_h=round(r, 2),
                    cum_3h_mm=round(cum3, 2),
                    exceedance_mm_h=round(physics.exceedance_mm_h(p, r), 2),
                    depth_cm=round(depth, 2),
                    flooded=depth >= physics.FLOOD_DEPTH_CM,
                    risk=physics.risk_score(p, r, cum3, depth),
                )
            )
    return states
