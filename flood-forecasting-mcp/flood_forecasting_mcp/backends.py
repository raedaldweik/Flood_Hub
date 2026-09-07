"""Backend adapters. `SimulatedBackend` reads the virtual gauges the flood twin seeds into Postgres;
`LiveBackend` is the client for the real API, implemented and documented but disabled until pilot
access is granted (it raises a clear error rather than pretending)."""

from __future__ import annotations

import os
from datetime import UTC, datetime
from typing import Protocol

from .contract import (
    FloodStatus,
    Forecast,
    Gauge,
    rfc3339,
    severity_for,
    thresholds,
    trend_for,
)


class Backend(Protocol):
    name: str

    def search_gauges_by_area(
        self, min_lat: float, min_lng: float, max_lat: float, max_lng: float, page_size: int
    ) -> list[Gauge]: ...
    def get_gauge(self, gauge_id: str) -> Gauge | None: ...
    def query_gauge_forecasts(
        self, gauge_ids: list[str], issued_time_start: datetime | None, issued_time_end: datetime | None
    ) -> dict[str, list[Forecast]]: ...
    def query_latest_flood_status(self, gauge_ids: list[str], as_of: datetime | None) -> list[FloodStatus]: ...


def _parse_ts(value: str | datetime | None) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    return datetime.fromisoformat(str(value))


class SimulatedBackend:
    """Virtual gauges: one per district, forecasts derived from the flood twin's replay (depth at the hotspot)."""

    name = "simulated"

    def __init__(self, database_url: str | None = None) -> None:
        self.dsn = database_url or os.environ.get("FLOOD_MCP_DATABASE_URL") or os.environ.get("DATABASE_URL")
        if not self.dsn:
            raise RuntimeError("SimulatedBackend needs DATABASE_URL (or FLOOD_MCP_DATABASE_URL)")

    def _conn(self):
        import psycopg
        from psycopg.rows import dict_row

        return psycopg.connect(self.dsn, row_factory=dict_row)

    @staticmethod
    def _gauge(r: dict) -> Gauge:
        return {
            "gaugeId": r["id"],
            "location": {"latitude": r["lat"], "longitude": r["lng"]},
            "siteName": r["name"],
            "source": "SIMULATED",
            "river": f"urban catchment · {r['zone_id']}" if r.get("zone_id") else "urban catchment",
            "countryCode": "QA",
            "qualityVerified": False,
            "hasModel": True,
            "gaugeValueUnit": "METERS",
        }

    def search_gauges_by_area(self, min_lat, min_lng, max_lat, max_lng, page_size=50) -> list[Gauge]:
        with self._conn() as c:
            rows = c.execute(
                "SELECT id, name, lat, lng, type, zone_id FROM gauges "
                "WHERE lat BETWEEN %s AND %s AND lng BETWEEN %s AND %s ORDER BY id LIMIT %s",
                (min_lat, max_lat, min_lng, max_lng, page_size),
            ).fetchall()
        return [self._gauge(r) for r in rows]

    def get_gauge(self, gauge_id: str) -> Gauge | None:
        with self._conn() as c:
            r = c.execute("SELECT id, name, lat, lng, type, zone_id FROM gauges WHERE id = %s", (gauge_id,)).fetchone()
        return self._gauge(r) if r else None

    def query_gauge_forecasts(
        self, gauge_ids, issued_time_start=None, issued_time_end=None
    ) -> dict[str, list[Forecast]]:
        start, end = _parse_ts(issued_time_start), _parse_ts(issued_time_end)
        sql = "SELECT gauge_id, issued_ts, lead_h, value FROM gauge_forecasts WHERE gauge_id = ANY(%s)"
        args: list = [list(gauge_ids)]
        if start:
            sql += " AND issued_ts >= %s"
            args.append(start)
        if end:
            sql += " AND issued_ts <= %s"
            args.append(end)
        sql += " ORDER BY gauge_id, issued_ts, lead_h"
        with self._conn() as c:
            rows = c.execute(sql, args).fetchall()
        out: dict[str, list[Forecast]] = {g: [] for g in gauge_ids}
        current: Forecast | None = None
        for r in rows:
            key = (r["gauge_id"], r["issued_ts"])
            if current is None or (current["gaugeId"], current["issuedTime"]) != (key[0], rfc3339(key[1])):
                current = {
                    "gaugeId": r["gauge_id"],
                    "issuedTime": rfc3339(r["issued_ts"]),
                    "forecastRanges": [],
                    "gaugeValueUnit": "METERS",
                    "source": "SIMULATED",
                }
                out[r["gauge_id"]].append(current)
            from datetime import timedelta

            t0 = r["issued_ts"] + timedelta(hours=r["lead_h"] - 1)
            current["forecastRanges"].append(
                {
                    "forecastStartTime": rfc3339(t0),
                    "forecastEndTime": rfc3339(t0 + timedelta(hours=1)),
                    "value": round(r["value"] / 100.0, 3),
                }
            )
        return out

    def query_latest_flood_status(self, gauge_ids, as_of=None) -> list[FloodStatus]:
        as_of_ts = _parse_ts(as_of)
        statuses: list[FloodStatus] = []
        with self._conn() as c:
            for gid in gauge_ids:
                if as_of_ts:
                    issued = c.execute(
                        "SELECT max(issued_ts) AS t FROM gauge_forecasts WHERE gauge_id = %s AND issued_ts <= %s",
                        (gid, as_of_ts),
                    ).fetchone()
                else:
                    issued = c.execute(
                        "SELECT max(issued_ts) AS t FROM gauge_forecasts WHERE gauge_id = %s", (gid,)
                    ).fetchone()
                if not issued or issued["t"] is None:
                    continue
                rows = c.execute(
                    "SELECT lead_h, value FROM gauge_forecasts WHERE gauge_id = %s AND issued_ts = %s ORDER BY lead_h",
                    (gid, issued["t"]),
                ).fetchall()
                values_m = [r["value"] / 100.0 for r in rows]
                if not values_m:
                    continue
                from datetime import timedelta

                peak = max(values_m)
                statuses.append(
                    {
                        "gaugeId": gid,
                        "issuedTime": rfc3339(issued["t"]),
                        "forecastTimeRange": {
                            "start": rfc3339(issued["t"]),
                            "end": rfc3339(issued["t"] + timedelta(hours=rows[-1]["lead_h"])),
                        },
                        "severity": severity_for(peak),
                        "forecastTrend": trend_for(values_m),
                        "forecastChange": {"valueChange": round(max(values_m) - values_m[0], 3), "unit": "METERS"},
                        "thresholds": thresholds(),
                        "gaugeValueUnit": "METERS",
                        "qualityVerified": False,
                        "mapInferenceType": "MODEL",
                        "source": "SIMULATED",
                    }
                )
        return statuses


class LiveBackend:
    """Client for the real Flood Forecasting API (pilot-gated).

    Endpoints, per the published reference, all under https://floodforecasting.googleapis.com/v1:
      GET  gauges:searchGaugesByArea?regionCode=…   (or a lat/lng bounding box)
      GET  gauges/{gaugeId}
      POST gauges:queryGaugeForecasts   body {gaugeIds, issuedTimeStart, issuedTimeEnd}
      POST floodStatus:queryLatestFloodStatus   body {gaugeIds}
    Authentication: API key (`?key=`) from a project enrolled in the pilot.
    """

    name = "live"
    BASE = "https://floodforecasting.googleapis.com/v1"

    def __init__(self, api_key: str | None = None) -> None:
        self.api_key = api_key or os.environ.get("FLOOD_API_KEY", "")
        if not self.api_key:
            raise RuntimeError("LiveBackend needs FLOOD_API_KEY — the Flood Forecasting API is pilot-gated")

    def _get(self, path: str, params: dict) -> dict:
        import httpx

        r = httpx.get(f"{self.BASE}/{path}", params={**params, "key": self.api_key}, timeout=20)
        r.raise_for_status()
        return r.json()

    def _post(self, path: str, body: dict) -> dict:
        import httpx

        r = httpx.post(f"{self.BASE}/{path}", params={"key": self.api_key}, json=body, timeout=20)
        r.raise_for_status()
        return r.json()

    def search_gauges_by_area(self, min_lat, min_lng, max_lat, max_lng, page_size=50) -> list[Gauge]:
        # The public method searches by region code; a bounding box is filtered client-side.
        data = self._get("gauges:searchGaugesByArea", {"regionCode": "QA", "pageSize": page_size})
        return [
            g
            for g in data.get("gauges", [])
            if min_lat <= g["location"]["latitude"] <= max_lat and min_lng <= g["location"]["longitude"] <= max_lng
        ]

    def get_gauge(self, gauge_id: str) -> Gauge | None:
        return self._get(f"gauges/{gauge_id}", {})

    def query_gauge_forecasts(
        self, gauge_ids, issued_time_start=None, issued_time_end=None
    ) -> dict[str, list[Forecast]]:
        body: dict = {"gaugeIds": list(gauge_ids)}
        if issued_time_start:
            body["issuedTimeStart"] = issued_time_start
        if issued_time_end:
            body["issuedTimeEnd"] = issued_time_end
        data = self._post("gauges:queryGaugeForecasts", body)
        return {gid: v.get("forecasts", []) for gid, v in data.get("forecasts", {}).items()}

    def query_latest_flood_status(self, gauge_ids, as_of=None) -> list[FloodStatus]:
        data = self._post("floodStatus:queryLatestFloodStatus", {"gaugeIds": list(gauge_ids)})
        return data.get("floodStatuses", [])


def make_backend() -> Backend:
    kind = os.environ.get("FLOOD_MCP_BACKEND", "simulated").lower()
    if kind == "live":
        return LiveBackend()
    return SimulatedBackend()
