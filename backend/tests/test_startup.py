"""The startup gate: the port answers before the database does."""

from fastapi.testclient import TestClient

from sadd.main import app
from sadd.startup import STATE


def test_gate_answers_503_with_the_phase_until_ready():
    original = (STATE.phase, STATE.detail)
    STATE.set("seeding", "test")
    try:
        client = TestClient(app)  # no lifespan → no startup thread → the phase stays as set
        r = client.get("/api/zones")
        assert r.status_code == 503 and r.json()["startup"]["phase"] == "seeding"
        assert r.headers["retry-after"] == "3"
        h = client.get("/api/health")
        assert h.status_code == 200 and h.json()["ok"] is True and h.json()["startup"]["phase"] == "seeding"
        m = client.get("/api/meta").json()
        assert m["startup"]["phase"] == "seeding" and m["replay"] is None
    finally:
        STATE.set(*original)


def test_gate_lets_traffic_through_when_ready():
    original = (STATE.phase, STATE.detail)
    STATE.set("ready")
    try:
        r = TestClient(app).get("/api/rules")
        assert r.status_code == 200
    finally:
        STATE.set(*original)
