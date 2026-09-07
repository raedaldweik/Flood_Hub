"""flood-forecasting-mcp — an MCP server that mirrors Google's Flood Forecasting API contract.

Backends (env FLOOD_MCP_BACKEND): `simulated` serves virtual Doha gauges from Postgres;
`live` is the stubbed client for the pilot-gated API. Same tool names, same field names,
same enums either way — swapping is configuration, not code.
"""

__version__ = "0.1.0"
