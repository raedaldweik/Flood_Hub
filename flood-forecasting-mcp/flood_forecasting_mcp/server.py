"""The MCP server: four tools that mirror Google's Flood Forecasting API methods.

Run: `flood-forecasting-mcp` (stdio) or `python -m flood_forecasting_mcp.server`.
Env:  FLOOD_MCP_BACKEND=simulated|live · DATABASE_URL (simulated) · FLOOD_API_KEY (live)
"""

from __future__ import annotations

import sys
from typing import Any

from mcp.server.mcpserver import MCPServer

from . import __version__
from .backends import Backend, make_backend

server = MCPServer(
    "flood-forecasting-mcp",
    instructions=(
        "Flood gauge search, forecasts and latest flood status for Doha, following Google's Flood Forecasting "
        "API contract. Times are RFC 3339 UTC; values are metres of water depth at the gauge. "
        "Pass `as_of` (RFC 3339) to query_latest_flood_status when reasoning about a moment in a replay."
    ),
)
_backend: Backend | None = None


def backend() -> Backend:
    global _backend
    if _backend is None:
        _backend = make_backend()
    return _backend


@server.tool()
def search_gauges_by_area(
    min_lat: float = 25.15, min_lng: float = 51.35, max_lat: float = 25.45, max_lng: float = 51.70, page_size: int = 50
) -> dict[str, Any]:
    """Mirror of gauges.searchGaugesByArea: gauges inside a lat/lng bounding box (defaults cover Doha)."""
    gauges = backend().search_gauges_by_area(min_lat, min_lng, max_lat, max_lng, page_size)
    return {"gauges": gauges, "backend": backend().name}


@server.tool()
def get_gauge(gauge_id: str) -> dict[str, Any]:
    """Mirror of gauges.get: one gauge by id (e.g. DOHA-NAJMA)."""
    g = backend().get_gauge(gauge_id)
    return g if g else {"error": f"gauge {gauge_id} not found"}


@server.tool()
def query_gauge_forecasts(
    gauge_ids: list[str], issued_time_start: str = "", issued_time_end: str = ""
) -> dict[str, Any]:
    """Mirror of gauges.queryGaugeForecasts: hourly forecast ranges per issue time (metres), optionally windowed."""
    out = backend().query_gauge_forecasts(gauge_ids, issued_time_start or None, issued_time_end or None)
    return {"forecasts": {gid: {"gaugeId": gid, "forecasts": f} for gid, f in out.items()}, "backend": backend().name}


@server.tool()
def query_latest_flood_status(gauge_ids: list[str], as_of: str = "") -> dict[str, Any]:
    """Mirror of floodStatus.queryLatestFloodStatus: severity, trend and thresholds from the latest issue
    at or before `as_of` (RFC 3339; empty = newest available)."""
    statuses = backend().query_latest_flood_status(gauge_ids, as_of or None)
    return {"floodStatuses": statuses, "backend": backend().name}


def main() -> None:
    print(f"flood-forecasting-mcp {__version__} · backend={backend().name}", file=sys.stderr, flush=True)
    server.run(transport="stdio")


if __name__ == "__main__":
    main()
