-- PROJECT SADD — one database, three concerns (relational, geospatial, vector).
-- GCP mapping: PostGIS → BigQuery GEOGRAPHY, pgvector → Vertex AI Search.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;
