"""Feature definitions shared by training, serving, the what-if engine and the Rafid tools.

Two models (CLAUDE.md §6):

1. Risk nowcast — zone risk 0–100 from what an operator can observe now:
   rain intensity, 3-hour accumulation, drainage capacity, imperviousness, elevation, underpass.
   Labels come from the transparent physics_v0 generator (+ noise), so the model recovers the same
   monotonic relationships and its TreeSHAP contributions can be compared with the formula.

2. Time-to-drain — hours to clear a flooded hotspot from a mass balance at the hotspot:
       hours ≈ volume ÷ (pumps + local drainage − inflow)
   Pumps work where water collects, not on the zone average: an underpass basin of ~8,000 m² is
   what a 250 m³/h truck empties in hours. Basin sizes are the geometric twin of the
   `concentration` factor in physics.py (a large catchment into a small basin).
"""

from __future__ import annotations

from ..sim.physics import ZoneParams, inflow_mm_h

RISK_FEATURES: tuple[str, ...] = (
    "rain_mm_h",
    "cum_3h_mm",
    "drainage_capacity_mm_h",
    "imperviousness_pct",
    "elevation_m",
    "has_underpass",
)
DRAIN_FEATURES: tuple[str, ...] = ("volume_m3", "pump_m3_h", "drainage_m3_h", "inflow_m3_h", "net_m3_h")

# Driver ids the UI already labels (i18n `driver_*`), keyed by feature name.
RISK_FEATURE_DRIVER = {
    "rain_mm_h": "rain_intensity",
    "cum_3h_mm": "cumulative_3h",
    "drainage_capacity_mm_h": "drainage_capacity",
    "imperviousness_pct": "imperviousness",
    "elevation_m": "low_elevation",
    "has_underpass": "underpass",
}

HOTSPOT_BASIN_M2_UNDERPASS = 8_000.0
HOTSPOT_BASIN_M2_STREET = 25_000.0
TTD_CAP_H = 48.0  # "not draining while it still rains harder than it drains"


def hotspot_basin_m2(p: ZoneParams) -> float:
    return HOTSPOT_BASIN_M2_UNDERPASS if p.has_underpass else HOTSPOT_BASIN_M2_STREET


def risk_features(p: ZoneParams, rain_mm_h: float, cum_3h_mm: float) -> list[float]:
    return [
        float(rain_mm_h),
        float(cum_3h_mm),
        float(p.drainage_capacity_mm_h),
        float(p.imperviousness_pct),
        float(p.elevation_m),
        1.0 if p.has_underpass else 0.0,
    ]


def hotspot_volume_m3(p: ZoneParams, depth_cm: float) -> float:
    return max(0.0, depth_cm) / 100.0 * hotspot_basin_m2(p)


def hotspot_drainage_m3_h(p: ZoneParams) -> float:
    """What the drains under the basin take away (mm/h over the basin area)."""
    return p.drainage_capacity_mm_h / 1000.0 * hotspot_basin_m2(p)


def hotspot_inflow_m3_h(p: ZoneParams, rain_mm_h: float) -> float:
    """Runoff still arriving from the basin's catchment (basin × concentration)."""
    return inflow_mm_h(p, rain_mm_h) / 1000.0 * hotspot_basin_m2(p) * p.concentration


def drain_features(volume_m3: float, pump_m3_h: float, drainage_m3_h: float, inflow_m3_h: float) -> list[float]:
    """Raw terms plus the physics-informed net rate, which is what actually sets the clearing time."""
    net = pump_m3_h + drainage_m3_h - inflow_m3_h
    return [float(volume_m3), float(pump_m3_h), float(drainage_m3_h), float(inflow_m3_h), float(net)]


def ttd_truth_hours(volume_m3: float, pump_m3_h: float, drainage_m3_h: float, inflow_m3_h: float) -> float:
    """The transparent mass-balance answer the model is trained around (shown in the UI tooltip)."""
    if volume_m3 <= 0:
        return 0.0
    net = pump_m3_h + drainage_m3_h - inflow_m3_h
    if net <= 1e-6:
        return TTD_CAP_H
    return min(TTD_CAP_H, volume_m3 / net)
