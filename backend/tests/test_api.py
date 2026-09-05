"""API smoke tests — run against a seeded database; skipped when Postgres is unreachable."""

import pytest
from fastapi.testclient import TestClient

from sadd.db import ping
from sadd.main import app

pytestmark = pytest.mark.skipif(not ping(), reason="database not reachable")
client = TestClient(app)


def test_meta_and_health():
    assert client.get("/api/health").json()["ok"] is True
    m = client.get("/api/meta").json()
    assert m["database_ok"] and m["physics"]["source"] == "physics_v0"
    assert m["replay"]["n_ticks"] > 0


def test_zones_geojson():
    z = client.get("/api/zones").json()
    assert z["type"] == "FeatureCollection" and len(z["features"]) == 12
    props = z["features"][0]["properties"]
    assert props["area_km2"] > 0 and len(props["centroid"]) == 2


def test_timeline_is_rectangular():
    t = client.get("/api/replay/timeline").json()
    n = t["meta"]["n_ticks"]
    assert len(t["ts"]) == n == len(t["city_rain"]) == len(t["kpis"]["active_alerts"])
    for z in t["zones"].values():
        assert len(z["risk"]) == n


def test_alerts_and_rules():
    alerts = client.get("/api/alerts").json()
    assert alerts and all(a["rule_id"].startswith("R-") for a in alerts)
    assert {r["id"] for r in client.get("/api/rules").json()} >= {"R-01", "R-02", "R-03"}


def test_explain():
    z = client.get("/api/zones").json()["features"][0]["properties"]["id"]
    peak = client.get("/api/replay/meta").json()["peak_tick"]
    e = client.get(f"/api/zones/{z}/explain", params={"tick": peak}).json()
    assert abs(sum(c["points"] for c in e["contributions"]) - e["risk"]) < 0.6
