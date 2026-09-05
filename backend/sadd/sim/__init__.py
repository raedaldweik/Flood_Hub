"""Simulation engine: transparent physics baseline + replay timeline precompute.

This is a decision-support demo, not a hydrological model. The mass balance is
deliberately simple and fully documented in `physics.py` so it can be defended in Q&A.
"""

from .physics import (  # noqa: F401
    FLOOD_DEPTH_CM,
    RISK_SOURCE,
    ZoneParams,
    ZoneState,
    explain_risk,
    risk_score,
    step,
)
from .replay import build_timeline, distribute_rain, interpolate_ticks  # noqa: F401
