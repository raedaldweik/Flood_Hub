# flood-forecasting-mcp

An [MCP](https://modelcontextprotocol.io) server that exposes flood gauges, forecasts and flood
status through the same tool names, field names and enums as Google's public
[Flood Forecasting API](https://developers.google.com/flood-forecasting).

> Google's Flood Forecasting API is pilot-gated. This server is built contract-first against the
> published API specification and runs on simulated + open historical data; it switches to the
> live API with one environment variable when pilot access is granted. To our knowledge this is
> the first MCP server for Google's Flood Forecasting API.

## Tools

| Tool | Mirrors | Returns |
|---|---|---|
| `search_gauges_by_area(min_lat, min_lng, max_lat, max_lng, page_size)` | `gauges.searchGaugesByArea` | `{gauges: [Gauge]}` |
| `get_gauge(gauge_id)` | `gauges.get` | `Gauge` |
| `query_gauge_forecasts(gauge_ids, issued_time_start?, issued_time_end?)` | `gauges.queryGaugeForecasts` | `{forecasts: {gaugeId: {forecasts: [Forecast]}}}` |
| `query_latest_flood_status(gauge_ids, as_of?)` | `floodStatus.queryLatestFloodStatus` | `{floodStatuses: [FloodStatus]}` |

`Gauge`, `Forecast` and `FloodStatus` carry the API's field names (`gaugeId`, `issuedTime`,
`forecastRanges`, `severity`, `forecastTrend`, `thresholds`, `gaugeValueUnit`, …) and enums
(`EXTREME | SEVERE | ABOVE_NORMAL | NO_FLOODING`, `RISE | FALL | NO_CHANGE`, `METERS`). See
`flood_forecasting_mcp/contract.py`. The one deliberate extension is `as_of` on the status
query, so an agent replaying a past storm can ask "what was the latest status *then*".

## Backends

```
FLOOD_MCP_BACKEND=simulated   # default — virtual gauges + forecasts from Postgres (DATABASE_URL)
FLOOD_MCP_BACKEND=live        # real API client; needs FLOOD_API_KEY from an enrolled project
```

*Simulated*: one virtual gauge per district of the flood twin, with hourly issued forecasts of
water depth at the district's hotspot derived from the replayed April-2024 storm (plus noise).
Severity uses depth thresholds at 0.15 / 0.30 / 0.50 m, the twin of the API's per-gauge
warning / danger / extreme-danger levels.

*Live*: `LiveBackend` implements the four calls against
`https://floodforecasting.googleapis.com/v1` with an API key, and refuses to start without one
instead of silently serving simulated data under a live label.

## Run

```bash
pip install -e .
DATABASE_URL=postgresql://sadd:sadd@localhost:5432/sadd flood-forecasting-mcp   # stdio transport
```

Any MCP client works; the flood twin's agent (Google ADK) launches it as a stdio subprocess.

## License

MIT.
