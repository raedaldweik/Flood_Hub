"""The shapes and enums of Google's public Flood Forecasting API (v1), reproduced so every backend
speaks the same contract. Field names are camelCase as the API returns them.

Sources: the published REST reference for `gauges`, `gaugeModels`, `floodStatus` and the
`queryGaugeForecasts` / `queryLatestFloodStatus` / `searchGaugesByArea` methods. Where the
API's enum values are not sensible for simulated urban gauges (e.g. `source`), the value is
still a string from the same field so clients need no special-casing.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal, TypedDict

Severity = Literal["SEVERITY_UNSPECIFIED", "EXTREME", "SEVERE", "ABOVE_NORMAL", "NO_FLOODING", "UNKNOWN"]
ForecastTrend = Literal["FORECAST_TREND_UNSPECIFIED", "RISE", "FALL", "NO_CHANGE"]
GaugeValueUnit = Literal["GAUGE_VALUE_UNIT_UNSPECIFIED", "METERS", "CUBIC_METERS_PER_SECOND"]
MapInferenceType = Literal["MAP_INFERENCE_TYPE_UNSPECIFIED", "MODEL", "IMAGE_CLASSIFICATION"]

# Depth thresholds (metres at the hotspot) — the simulated twin of the API's per-gauge thresholds.
WARNING_LEVEL_M = 0.15
DANGER_LEVEL_M = 0.30
EXTREME_DANGER_LEVEL_M = 0.50


class LatLng(TypedDict):
    latitude: float
    longitude: float


class Gauge(TypedDict):
    gaugeId: str
    location: LatLng
    siteName: str
    source: str
    river: str
    countryCode: str
    qualityVerified: bool
    hasModel: bool
    gaugeValueUnit: GaugeValueUnit


class ForecastRange(TypedDict):
    forecastStartTime: str
    forecastEndTime: str
    value: float


class Forecast(TypedDict):
    gaugeId: str
    issuedTime: str
    forecastRanges: list[ForecastRange]
    gaugeValueUnit: GaugeValueUnit
    source: str


class Thresholds(TypedDict):
    warningLevel: float
    dangerLevel: float
    extremeDangerLevel: float


class FloodStatus(TypedDict):
    gaugeId: str
    issuedTime: str
    forecastTimeRange: dict[str, str]
    severity: Severity
    forecastTrend: ForecastTrend
    forecastChange: dict[str, float | str]
    thresholds: Thresholds
    gaugeValueUnit: GaugeValueUnit
    qualityVerified: bool
    mapInferenceType: MapInferenceType
    source: str


def rfc3339(ts: datetime) -> str:
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=UTC)
    return ts.astimezone(UTC).isoformat().replace("+00:00", "Z")


def severity_for(value_m: float) -> Severity:
    if value_m >= EXTREME_DANGER_LEVEL_M:
        return "EXTREME"
    if value_m >= DANGER_LEVEL_M:
        return "SEVERE"
    if value_m >= WARNING_LEVEL_M:
        return "ABOVE_NORMAL"
    return "NO_FLOODING"


def trend_for(values_m: list[float], tolerance_m: float = 0.02) -> ForecastTrend:
    """RISE when the forecast climbs above its first value at any point; FALL when it only recedes."""
    if not values_m:
        return "FORECAST_TREND_UNSPECIFIED"
    first, peak = values_m[0], max(values_m)
    if peak - first > tolerance_m:
        return "RISE"
    if first - values_m[-1] > tolerance_m:
        return "FALL"
    return "NO_CHANGE"


def thresholds() -> Thresholds:
    return {
        "warningLevel": WARNING_LEVEL_M,
        "dangerLevel": DANGER_LEVEL_M,
        "extremeDangerLevel": EXTREME_DANGER_LEVEL_M,
    }
