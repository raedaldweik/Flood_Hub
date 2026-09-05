"""Pydantic response models — the contract the frontend types are generated from by hand."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel

Severity = Literal["yellow", "orange", "red"]


class ZoneProperties(BaseModel):
    id: str
    name_en: str
    name_ar: str
    area_km2: float
    elevation_m: float
    imperviousness_pct: float
    drainage_capacity_mm_per_h: float
    population: int
    has_underpass: bool
    criticality: int
    rain_factor: float
    notes: str | None
    centroid: list[float]  # [lng, lat]


class ZoneFeature(BaseModel):
    type: Literal["Feature"] = "Feature"
    geometry: dict[str, Any]
    properties: ZoneProperties


class ZoneCollection(BaseModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[ZoneFeature]


class ReplayMeta(BaseModel):
    start_ts: datetime
    end_ts: datetime
    tick_minutes: int
    n_ticks: int
    peak_tick: int
    rain_source: str
    risk_source: str
    seeded_at: datetime


class ZoneSeries(BaseModel):
    rain: list[float]
    cum_3h: list[float]
    exceedance: list[float]
    depth_cm: list[float]
    risk: list[float]
    flooded: list[bool]


class KpiSeries(BaseModel):
    active_alerts: list[int]
    zones_at_risk: list[int]
    zones_flooded: list[int]
    assets_deployed: list[int]
    population_affected: list[int]
    lead_time_min: list[float | None]


class Timeline(BaseModel):
    meta: ReplayMeta
    ts: list[datetime]
    city_rain: list[float]
    zones: dict[str, ZoneSeries]
    kpis: KpiSeries


class Alert(BaseModel):
    id: int
    ts: datetime
    tick: int | None
    zone_id: str
    severity: Severity
    type: str
    message_en: str
    message_ar: str
    rule_id: str
    rule_version: str
    status: str
    cleared_ts: datetime | None
    cleared_tick: int | None


class Asset(BaseModel):
    id: str
    callsign: str
    callsign_ar: str
    type: str
    capacity_m3_h: float
    lat: float
    lng: float
    depot_id: str | None
    zone_id: str | None
    status: str


class Depot(BaseModel):
    id: str
    name_en: str
    name_ar: str
    lat: float
    lng: float


class Contribution(BaseModel):
    driver: str
    points: float


class ZoneExplanation(BaseModel):
    zone_id: str
    tick: int
    risk: float
    band: str
    contributions: list[Contribution]
    inputs: dict[str, float | bool]


class Meta(BaseModel):
    app: str
    version: str
    database_ok: bool
    replay: ReplayMeta | None
    counts: dict[str, int]
    physics: dict[str, Any]
    features: dict[str, bool]
    disclaimers: dict[str, str]


class LiveWeather(BaseModel):
    available: bool
    source: str
    fetched_at: datetime | None = None
    error: str | None = None
    current: dict[str, Any] | None = None
    hourly: list[dict[str, Any]] = []
