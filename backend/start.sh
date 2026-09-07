#!/bin/sh
# Container entrypoint: MCP Toolbox for Databases (when the binary is present) beside the API.
# The API never depends on Toolbox being up — Rafid falls back to local tools with the same queries.
set -u
cd "$(dirname "$0")"
if command -v toolbox >/dev/null 2>&1 && [ -n "${DATABASE_URL:-}" ]; then
  eval "$(python -c 'import os, urllib.parse as u
p = u.urlparse(os.environ["DATABASE_URL"])
print(f"export PGHOST={p.hostname} PGPORT={p.port or 5432} PGDATABASE={p.path.lstrip(chr(47))} PGUSER={u.unquote(p.username or chr(39)+chr(39))} PGPASSWORD={u.unquote(p.password or chr(39)+chr(39))}")')"
  (
    for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
      toolbox --tools-file toolbox/tools.yaml --address 127.0.0.1 --port "${TOOLBOX_PORT:-5000}" --disable-reload && break
      echo "[toolbox] not up yet (attempt $i) — retrying in 10s"; sleep 10
    done
  ) &
fi
exec uvicorn sadd.main:app --host 0.0.0.0 --port "${PORT:-8000}" --proxy-headers --forwarded-allow-ips='*'
