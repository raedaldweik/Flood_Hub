# agent/ — arrives in Phase 3

Rafid is built with Google ADK on Gemini (flash tier by default). Tools: `db` via MCP
Toolbox for Databases (read-only Postgres credentials), `flood` via the custom
`flood-forecasting-mcp`, plus local tools `score_zone`, `search_protocols` (pgvector),
`propose_dispatch_plan` and `draft_advisory`. The only path to changing asset state is
`rules.validate_and_apply(plan, operator_id)` after an operator clicks APPROVE.

Phase 1 ships the panel shell and the `/api/agent/status` flag so the UI shows an honest
offline notice until the key and the agent exist.
