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


def test_rule_catalog_carries_test_coverage(client):
    rules = client.get("/api/rules").json()
    by_id = {r["id"]: r for r in rules}
    assert by_id["R-05"]["kind"] == "gate" and by_id["R-08"]["kind"] == "gate" and by_id["R-01"]["kind"] == "timeline"
    # Every rule has at least one pytest function exercising it — the Governance tab shows the count.
    assert all(r["test_count"] >= 1 for r in rules), {r["id"]: r["test_count"] for r in rules}


def test_propose_then_stand_down_moves_and_returns_the_fleet(client):
    plan = client.post("/api/agent/plans/propose", json={"storm_multiplier": 1.5, "objective": "test"}).json()
    assert plan["status"] == "proposed" and sum(plan["allocations"].values()) > 0
    ok = client.post(f"/api/agent/plans/{plan['plan_id']}/approve", json={"operator_id": "ops-01"})
    assert ok.status_code == 200, ok.text
    moved = ok.json()["result"]["assignments"]
    assert moved and all("lat" in a and "lng" in a for a in moved)
    assets = {a["id"]: a for a in client.get("/api/assets").json()}
    first = moved[0]
    assert assets[first["asset_id"]]["zone_id"] == first["zone_id"]
    assert abs(assets[first["asset_id"]]["lat"] - first["lat"]) < 1e-6

    down = client.post("/api/agent/fleet/stand-down", json={"operator_id": "ops-01"})
    assert down.status_code == 200, down.text
    assert down.json()["rule"] == "R-08 v1.0" and down.json()["units_returned"] >= len(moved)
    assets = client.get("/api/assets").json()
    assert all(a["status"] == "idle" and a["zone_id"] is None for a in assets)
    log = client.get("/api/decisions", params={"rule_id": "R-08", "limit": 1}).json()
    assert log and log[0]["decision_type"] == "stand_down" and log[0]["approved_by"] == "ops-01"
    assert client.post("/api/agent/fleet/stand-down", json={"operator_id": "x"}).status_code == 422


def test_executive_report(client):
    r = client.get("/api/executive", params={"lang": "en"}).json()
    sc = r["scorecards"]
    assert sc["alert_lead_time_min"]["sadd"] > 0 and sc["avoided_damage_qar"]["sadd"] > 0
    assert sc["time_to_drain_h"]["sadd"] < sc["time_to_drain_h"]["actual"]
    assert sc["road_closure_h"]["sadd"] < sc["road_closure_h"]["actual"] and sc["road_closure_h"]["km_affected"] > 0
    assert {c["key"] for c in r["comparison"]} >= {"damage_qar", "road_closure_h", "alert_lead_time_h"}
    assert r["trend"] and r["summary"]["source"] in ("template", "gemini") and len(r["summary"]["text"]) > 20
    ar = client.get("/api/executive", params={"lang": "ar"}).json()
    assert ar["summary"]["text"] != r["summary"]["text"]
