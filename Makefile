# PROJECT SADD — developer entrypoints.
#   make setup   install backend (uv/pip) + frontend (npm) dependencies
#   make db      start Postgres (PostGIS + pgvector) via docker compose
#   make schema  (re)apply extensions + schema to the running database
#   make seed    load zones, April-2024 rain, assets, protocols; precompute replay
#   make train   train the two ML models (Phase 2)
#   make dev     run backend (:8000) and frontend (:3000) together
#   make test    run pytest (rules + sim + api)
SHELL := /bin/bash
.DEFAULT_GOAL := help

PY      ?= python3
UV      := $(shell command -v uv 2>/dev/null)
VENV    := backend/.venv
PYBIN   := $(VENV)/bin
DATABASE_URL ?= postgresql://sadd:sadd@localhost:5432/sadd
export DATABASE_URL

help: ## show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

setup: ## install backend + frontend dependencies
ifdef UV
	cd backend && uv venv .venv --python 3.11 --allow-existing && uv pip install --python .venv/bin/python -e ".[dev]"
else
	$(PY) -m venv $(VENV) && $(PYBIN)/pip install -e "backend[dev]"
endif
	cd frontend && npm install

db: ## start Postgres (PostGIS + pgvector)
	docker compose up -d db
	@echo "waiting for postgres..." && until docker compose exec -T db pg_isready -U sadd -d sadd >/dev/null 2>&1; do sleep 1; done && echo "postgres ready"

db-down: ## stop Postgres (keeps data)
	docker compose down

db-reset: ## DESTROY the database volume and start fresh
	docker compose down -v && $(MAKE) db

schema: ## (re)apply extensions + schema
	psql "$(DATABASE_URL)" -v ON_ERROR_STOP=1 -f backend/sql/00_extensions.sql
	psql "$(DATABASE_URL)" -v ON_ERROR_STOP=1 -f backend/sql/01_schema.sql

seed: ## load reference data + precompute the April-2024 replay
	cd backend && $(CURDIR)/$(PYBIN)/python -m sadd.seed

train: ## train risk + time-to-drain models (Phase 2)
	cd backend && $(CURDIR)/$(PYBIN)/python -m sadd.models.train

backend: ## run FastAPI with reload on :8000
	cd backend && $(CURDIR)/$(PYBIN)/uvicorn sadd.main:app --reload --port 8000

frontend: ## run Next.js dev server on :3000
	cd frontend && npm run dev

dev: ## run backend + frontend together (Ctrl-C stops both)
	@trap 'kill 0' INT TERM; \
	  ( $(MAKE) backend ) & ( $(MAKE) frontend ) & wait

test: ## pytest for rules + sim + api
	cd backend && $(CURDIR)/$(PYBIN)/pytest -q

lint: ## ruff (python) + eslint/tsc (frontend)
	cd backend && $(CURDIR)/$(PYBIN)/ruff check sadd tests
	cd frontend && npm run lint && npx tsc --noEmit

.PHONY: help setup db db-down db-reset schema seed train backend frontend dev test lint
