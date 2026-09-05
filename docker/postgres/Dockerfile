# One image with BOTH PostGIS and pgvector.
# The official postgis image is Debian + PGDG apt repo, so pgvector is one apt-get away.
FROM postgis/postgis:16-3.4
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-16-pgvector \
 && rm -rf /var/lib/apt/lists/*
# Keep the cluster in a subdirectory of the volume mount: Railway (and some Docker hosts) mount
# volumes as non-empty, root-owned directories, which initdb refuses to use directly.
ENV PGDATA=/var/lib/postgresql/data/pgdata
