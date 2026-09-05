# One image with BOTH PostGIS and pgvector.
# The official postgis image is Debian + PGDG apt repo, so pgvector is one apt-get away.
FROM postgis/postgis:16-3.4
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-16-pgvector \
 && rm -rf /var/lib/apt/lists/*
