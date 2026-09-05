# Deploying PROJECT SADD on Railway

Two services in one Railway project, both built from this repository:

| Service | Root directory | What it runs |
|---|---|---|
| `sadd-db`  | `docker/postgres` | Postgres 16 + PostGIS + pgvector (our image — Railway's stock Postgres has neither extension) |
| `sadd-app` | `/` (repo root)   | One container: FastAPI serves the API **and** the Next.js static export. Seeds the database on first boot. |

The app reaches the database over Railway's private network; the browser only ever talks to
`sadd-app`, so there is no CORS to configure and Rafid's SSE stream (Phase 3) stays same-origin.

## 1. Create the project

Railway dashboard → **New Project** → **Deploy from GitHub repo** → `raedaldweik/Flood_Hub`.
Railway creates one service from the repo root; rename it **`sadd-app`**. Under *Settings → Source*
pick the branch to deploy (your default branch, or `claude/project-sadd-flood-twin-gaywht`).
It reads `railway.json` (Dockerfile build, `/api/health` healthcheck) automatically.

## 2. Add the database service

*New → GitHub repo → Flood_Hub* again, name it **`sadd-db`**, then in *Settings*:

- **Root Directory**: `docker/postgres` (Railway then uses `docker/postgres/railway.json` and its Dockerfile)
- **Volumes → Add volume**, mount path: `/var/lib/postgresql/data`
- **Networking**: no public domain needed. Add a TCP proxy only if you want to `psql` in from your laptop.

Variables for `sadd-db`:

| Variable | Value |
|---|---|
| `POSTGRES_USER` | `sadd` |
| `POSTGRES_PASSWORD` | a long random secret (Railway can generate one) |
| `POSTGRES_DB` | `sadd` |

`PGDATA` is already set inside the image to `/var/lib/postgresql/data/pgdata`.

## 3. Variables for `sadd-app`

Reference variables (`${{sadd-db.X}}`) resolve to the database service, so nothing is copied by hand.

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://${{sadd-db.POSTGRES_USER}}:${{sadd-db.POSTGRES_PASSWORD}}@${{sadd-db.RAILWAY_PRIVATE_DOMAIN}}:5432/${{sadd-db.POSTGRES_DB}}` | private network, port 5432 |
| `SEED_ON_STARTUP` | `true` | first boot: schema + zones + Open-Meteo April-2024 replay + rules + fleet + protocols (≈10 s) |
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | your Maps Platform key | **build-time** — Railway passes it as a Docker build arg. Empty = 2D fallback map. Add `https://<your-app>.up.railway.app/*` to the key's HTTP-referrer allowlist, and redeploy after changing it. |
| `GEMINI_API_KEY` | AI Studio key | optional until Phase 3 |
| `GEMINI_MODEL` | `gemini-2.5-flash` | optional |
| `SEED_FORCE_FALLBACK` | `0` | set `1` to use the bundled synthetic storm curve instead of the ERA5 archive |
| `REPLAY_START_DATE` / `REPLAY_END_DATE` | `2024-04-15` / `2024-04-17` | optional |
| `REPLAY_TICK_MINUTES` | `10` | optional |
| `FLOOD_MCP_BACKEND` | `simulated` | Phase 3 |

Leave **unset**: `PORT` (Railway injects it), `NEXT_PUBLIC_API_BASE` (empty = same origin),
`CORS_ORIGINS` (not needed same-origin), `FRONTEND_DIST` and `SADD_DATA_DIR` (set inside the image).

Generate a public domain for `sadd-app` under *Settings → Networking → Generate Domain*.

## 4. Deploy order and first boot

Deploy `sadd-db` first, then `sadd-app`. On its first boot the app waits for the database (up to
a minute of retries while private DNS settles), finds `replay_meta` empty and runs the seed.
The healthcheck (`/api/health`, 300 s budget) turns green once the API answers.

Redeploys skip the seed. To re-seed from scratch run
`railway run --service sadd-app python -m sadd.seed` (the seed wipes and reloads the demo
tables), or delete the volume on `sadd-db`.

## 5. Sanity checks

```
https://<app>.up.railway.app/api/health   → {"ok":true,"database":true}
https://<app>.up.railway.app/api/meta     → counts; replay.rain_source is "open-meteo-archive" on Railway
https://<app>.up.railway.app/             → the Command Center
```

## Local equivalent of the production image

```bash
make prod        # builds frontend/out and serves UI + API from FastAPI on :8000
# or
docker build -t sadd . && docker run -p 8000:8000 -e DATABASE_URL=postgresql://... sadd
```
