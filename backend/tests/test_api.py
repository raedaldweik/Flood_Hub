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
    assert e["source"] in ("xgb_nowcast_v1", "physics_v0")
    # TreeSHAP contributions + baseline reproduce the scorer's risk; the physics fallback sums exactly.
    assert abs((e["baseline"] or 0) + sum(c["points"] for c in e["contributions"]) - e["model_risk"]) < 0.6


def test_models_and_sim(client):
    info = client.get("/api/models").json()
    assert info["risk"]["source"] in ("xgb_nowcast_v1", "physics_v0")
    zone = client.get("/api/zones").json()["features"][0]["properties"]["id"]
    s = client.post("/api/models/score", json={"zone_id": zone, "rain_multiplier": 2.0}).json()
    assert 0 <= s["risk"] <= 100 and s["band"] in ("green", "yellow", "orange", "red") and s["contributions"]
    base = client.get("/api/sim/baseline").json()
    assert base["kpis"]["zones_flooded"] >= 1 and base["elapsed_ms"] < 300
    r = client.post(
        "/api/sim/simulate", json={"storm_multiplier": 1.5, "allocations": {zone: 3}, "prepositioned": True}
    ).json()
    assert r["kpis"]["pumps_deployed"] == 3 and r["fleet_size"] >= 3 and "delta" in r
    bad = client.post("/api/sim/simulate", json={"allocations": {zone: 999}})
    assert bad.status_code == 422
