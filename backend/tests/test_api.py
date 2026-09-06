"""API smoke tests — run against a seeded database; skipped when Postgres is unreachable."""

import pytest
from fastapi.testclient import TestClient

from sadd.db import ping
from sadd.main import app
from sadd.startup import wait_until_done

pytestmark = pytest.mark.skipif(not ping(), reason="database not reachable")


@pytest.fixture(scope="module")
def client():
    # The context manager runs the lifespan, which starts the background startup thread.
    with TestClient(app) as c:
        assert wait_until_done(timeout=60), "startup did not reach `ready`"
        yield c


def test_meta_and_health(client):
    h = client.get("/api/health").json()
    assert h["ok"] is True and h["startup"]["phase"] == "ready"
    m = client.get("/api/meta").json()
    assert m["database_ok"] and m["physics"]["source"] == "physics_v0"
    assert m["replay"]["n_ticks"] > 0


def test_zones_geojson(client):
    z = client.get("/api/zones").json()
    assert z["type"] == "FeatureCollection" and len(z["features"]) == 12
    props = z["features"][0]["properties"]
    assert props["area_km2"] > 0 and len(props["centroid"]) == 2


def test_timeline_is_rectangular(client):
    t = client.get("/api/replay/timeline").json()
    n = t["meta"]["n_ticks"]
    assert len(t["ts"]) == n == len(t["city_rain"]) == len(t["kpis"]["active_alerts"])
    for z in t["zones"].values():
        assert len(z["risk"]) == n


def test_alerts_and_rules(client):
    alerts = client.get("/api/alerts").json()
    assert alerts and all(a["rule_id"].startswith("R-") for a in alerts)
    assert {r["id"] for r in client.get("/api/rules").json()} >= {"R-01", "R-02", "R-03"}


def test_explain(client):
    z = client.get("/api/zones").json()["features"][0]["properties"]["id"]
    peak = client.get("/api/replay/meta").json()["peak_tick"]
    e = client.get(f"/api/zones/{z}/explain", params={"tick": peak}).json()
    assert abs(sum(c["points"] for c in e["contributions"]) - e["risk"]) < 0.6
