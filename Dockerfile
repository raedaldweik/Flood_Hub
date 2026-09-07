# ─── Stage 1: build the Next.js static export ────────────────────────────────
FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
# NEXT_PUBLIC_* values are inlined at BUILD time. Railway passes service variables as build
# args when the Dockerfile declares them. Leave the Maps key empty and the app still runs on
# the 2D fallback. API base stays empty so the browser calls the same origin.
ARG NEXT_PUBLIC_GOOGLE_MAPS_KEY=""
ARG NEXT_PUBLIC_API_BASE=""
ARG NEXT_PUBLIC_GOOGLE_MAP_ID=""
ARG NEXT_PUBLIC_MAP_ENGINE=""
ENV NEXT_PUBLIC_GOOGLE_MAPS_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_KEY \
    NEXT_PUBLIC_GOOGLE_MAP_ID=$NEXT_PUBLIC_GOOGLE_MAP_ID \
    NEXT_PUBLIC_MAP_ENGINE=$NEXT_PUBLIC_MAP_ENGINE \
    NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ─── Stage 2: FastAPI serving the API and the static frontend ───────────────
FROM python:3.11-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1
COPY backend/pyproject.toml /app/backend/pyproject.toml
COPY backend/sadd /app/backend/sadd
COPY flood-forecasting-mcp /app/flood-forecasting-mcp
# Editable installs: the packages stay in place so sql/ and data/ resolve by path.
RUN pip install --upgrade pip && pip install -e /app/backend -e /app/flood-forecasting-mcp
# MCP Toolbox for Databases (Google OSS) — Rafid's situational toolset over Postgres (start.sh runs it).
ADD https://storage.googleapis.com/genai-toolbox/v0.12.0/linux/amd64/toolbox /usr/local/bin/toolbox
RUN chmod +x /usr/local/bin/toolbox
COPY backend/toolbox /app/backend/toolbox
COPY backend/start.sh /app/backend/start.sh
COPY backend/sql /app/backend/sql
# Train the risk nowcast + time-to-drain models (deterministic, a few seconds).
RUN cd /app/backend && python -m sadd.models.train
COPY data /app/data
# Risk-lit towers: OpenStreetMap footprints with heights for central Doha (sadd/buildings.py).
# Best effort — an unreachable Overpass API means no towers, never a failed build.
RUN cd /app/backend && SADD_DATA_DIR=/app/data python -m sadd.buildings || true
COPY --from=frontend-build /app/frontend/out /app/frontend/out
ENV FRONTEND_DIST=/app/frontend/out \
    SADD_DATA_DIR=/app/data \
    SEED_ON_STARTUP=true \
    PORT=8000
WORKDIR /app/backend
EXPOSE 8000
# Railway forwards the public domain to the port in PORT; keep it 8000 everywhere (see docs/DEPLOY_RAILWAY.md).
CMD ["sh", "/app/backend/start.sh"]
