# flood-forecasting-mcp — arrives in Phase 3

A Python MCP server (official `mcp` SDK) that mirrors the public contract of Google's
Flood Forecasting API — `search_gauges_by_area`, `get_gauge`, `query_gauge_forecasts`,
`query_latest_flood_status` — with the same field names and enums wherever practical.

Google's Flood Forecasting API is pilot-gated. This server is built contract-first against
the published API specification and runs on simulated + open historical data (the `gauges`
and `gauge_forecasts` tables seeded by `make seed`); it switches to the live API with one
environment variable (`FLOOD_MCP_BACKEND=live`) when pilot access is granted. To our
knowledge this is the first MCP server for Google's Flood Forecasting API.

Phase 1 ships the backing tables and twelve virtual Doha gauges; the server itself,
its adapter pattern (`simulated | live`) and its Apache-2.0 license land in Phase 3.
