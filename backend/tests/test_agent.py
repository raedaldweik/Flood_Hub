"""Rafid's tools, the plan approval gate, the flood MCP server and the API — all without an LLM call."""

import asyncio
import json
import os

import pytest
from fastapi.testclient import TestClient

from sadd.agent import plans, tools
from sadd.agent.context import TURN, Turn
from sadd.agent.rag import search_protocols
from sadd.db import ping
from sadd.main import app
from sadd.rules import PlanRejected, validate_and_apply
from sadd.rules.rules import R05PlanValidation, get_rule
from sadd.startup import wait_until_done

pytestmark = pytest.mark.skipif(not ping(), reason="database not reachable")
PEAK = Turn(213, "2024-04-16T08:30:00Z", "Tue 16 Apr 2024 11:30 AST", "en", "replay")


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        assert wait_until_done(timeout=60)
        yield c


@pytest.fixture(autouse=True)
def at_peak():
    token = TURN.set(PEAK)
    yield
    TURN.reset(token)


def test_situational_tools_read_the_replay():
    z = tools.get_zone_status("najma")
    assert z["tick"] == 213 and z["band"] in ("orange", "red") and z["has_underpass"]
    assert any(a["rule_id"].startswith("R-") for a in z["active_alerts"])
    at_risk = tools.list_zones_at_risk(min_risk=60)
    assert at_risk["count"] >= 1 and at_risk["zones"][0]["risk_score"] >= 60
    assert tools.get_kpis()["zones_at_risk"] >= 1
    assert tools.get_active_alerts()["count"] >= 1
    assert tools.get_assets()["count"] == 32
    assert tools.get_replay_context()["current"]["tick"] == 213
    assert "error" in tools.get_zone_status("atlantis")


def test_score_search_and_draft():
    s = tools.score_zone("west_bay", 2.0)
    assert s["band"] in ("orange", "red") and s["contributions"] and s["source"]
    r = tools.search_protocols("underpass closure")
    assert r["hits"] and r["hits"][0]["doc_id"].startswith("FOC-") and r["method"] in ("keyword", "pgvector")
    assert search_protocols("إغلاق الأنفاق", "ar")["hits"][0]["lang"] == "ar"
    d = tools.draft_advisory("najma", "red", "ar")
    assert d["status"] == "DRAFT" and "Najma" in d["sms_en"] and "نجمة" in d["sms_ar"] and d["chars_en"] <= 200


def test_plan_proposal_then_r05_gate():
    plan = tools.propose_dispatch_plan()
    assert plan["status"] == "proposed" and sum(plan["allocations"].values()) <= plan["fleet_size"]
    assert plan["expected"]["all_clear_h"] < plan["baseline"]["all_clear_h"]
    assert plans.get(plan["plan_id"]) is plan
    r05 = get_rule("R-05")
    assert isinstance(r05, R05PlanValidation)
    zones = {z: {"risk": 80.0, "recommended": False} for z in plan["allocations"]}
    assert r05.validate(plan, plan["fleet_size"], zones) == []
    assert r05.validate({"allocations": {"najma": 99}}, 24, {"najma": {"risk": 90.0}}) == [
        "99 trucks requested, fleet has 24"
    ]
    assert r05.validate({"allocations": {"calm": 2}}, 24, {"calm": {"risk": 10.0, "recommended": False}})
    assert r05.validate({"allocations": {}}, 24, {}) == ["plan has no allocations"]
    with pytest.raises(PlanRejected) as exc:
        validate_and_apply({"plan_id": "x", "allocations": {"najma": 99}}, "operator-01", zones, tick=213)
    assert exc.value.decision_id is not None


def test_approval_moves_trucks_and_logs(client):
    plan = tools.propose_dispatch_plan()
    res = client.post(f"/api/agent/plans/{plan['plan_id']}/approve", json={"operator_id": "operator-07"}).json()
    assert res["status"] == "approved" and res["result"]["trucks_moved"] == sum(plan["allocations"].values())
    assert res["result"]["rule"] == "R-05 v1.0" and res["result"]["approved_by"] == "operator-07"
    entry = tools.get_decision_log(1)["entries"][0]
    assert entry["rule_id"] == "R-05" and entry["approved_by"] == "operator-07" and entry["decision_type"] == "dispatch"
    on_site = tools.get_assets(next(iter(plan["allocations"])))
    assert on_site["count"] >= 1 and all(a["status"] == "staged" for a in on_site["assets"])
    assert client.post("/api/agent/plans/nope/approve", json={"operator_id": "ops"}).status_code == 404


def test_status_and_offline_chat_stream(client):
    st = client.get("/api/agent/status").json()
    assert st["name"] == "Rafid" and st["tools"]["flood_mcp"]["transport"] == "stdio"
    if st["online"]:
        pytest.skip("GEMINI_API_KEY is set; the offline stream is not exercised")
    with client.stream(
        "POST", "/api/agent/chat", json={"message": "hi", "session_id": "test-session", "lang": "ar", "tick": 5}
    ) as r:
        events = [json.loads(line[5:]) for line in r.iter_lines() if line.startswith("data:")]
    assert (
        events[0]["type"] == "text"
        and "GEMINI_API_KEY" in events[0]["delta"]
        and events[-1] == {"type": "done", "offline": True}
    )


def test_flood_mcp_server_mirrors_the_api_contract():
    os.environ.setdefault("DATABASE_URL", "postgresql://sadd:sadd@localhost:5432/sadd")
    from flood_forecasting_mcp.server import server
    from mcp.client import Client

    def payload(r):
        return r.structured_content or json.loads(r.content[0].text)

    async def run():
        async with Client(server) as c:
            names = {t.name for t in (await c.list_tools()).tools}
            assert names == {"search_gauges_by_area", "get_gauge", "query_gauge_forecasts", "query_latest_flood_status"}
            gauges = payload(await c.call_tool("search_gauges_by_area", {}))["gauges"]
            assert len(gauges) == 12 and {"gaugeId", "location", "siteName", "gaugeValueUnit"} <= set(gauges[0])
            st = payload(
                await c.call_tool(
                    "query_latest_flood_status", {"gauge_ids": ["DOHA-NAJMA"], "as_of": "2024-04-16T06:00:00Z"}
                )
            )
            s = st["floodStatuses"][0]
            assert s["severity"] in ("ABOVE_NORMAL", "SEVERE", "EXTREME") and s["forecastTrend"] == "RISE"
            assert s["thresholds"]["dangerLevel"] == 0.3 and s["gaugeValueUnit"] == "METERS"
            fc = payload(
                await c.call_tool(
                    "query_gauge_forecasts",
                    {
                        "gauge_ids": ["DOHA-NAJMA"],
                        "issued_time_start": "2024-04-16T05:00:00Z",
                        "issued_time_end": "2024-04-16T05:00:00Z",
                    },
                )
            )
            ranges = fc["forecasts"]["DOHA-NAJMA"]["forecasts"][0]["forecastRanges"]
            assert len(ranges) == 12 and ranges[0]["forecastStartTime"].endswith("Z")
            assert "error" in payload(await c.call_tool("get_gauge", {"gauge_id": "nope"}))

    asyncio.run(run())
