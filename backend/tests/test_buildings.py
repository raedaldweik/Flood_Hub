"""Risk-lit towers: OSM parsing, zone assignment and the API — no network, no database."""

import json

from fastapi.testclient import TestClient

from sadd import buildings
from sadd.api import buildings as api_buildings
from sadd.main import app


def _square(lng: float, lat: float, d: float = 0.0004) -> list[dict]:
    pts = [(lng - d, lat - d), (lng + d, lat - d), (lng + d, lat + d), (lng - d, lat + d), (lng - d, lat - d)]
    return [{"lon": x, "lat": y} for x, y in pts]


def test_parse_height_units_and_levels():
    assert buildings.parse_height({"height": "150"}) == 150
    assert buildings.parse_height({"height": "150 m"}) == 150
    assert abs(buildings.parse_height({"height": "492 ft"}) - 150) < 0.1
    assert buildings.parse_height({"building:levels": "40"}) == 40 * buildings.LEVEL_HEIGHT_M
    assert buildings.parse_height({"height": "tall"}) is None
    assert buildings.parse_height({}) is None


def test_overpass_to_features_filters_sorts_and_assigns_zones():
    zones = buildings.load_zone_rings()
    wb = dict(zones)["west_bay"]
    c_lng = sum(p[0] for p in wb) / len(wb)
    c_lat = sum(p[1] for p in wb) / len(wb)
    assert buildings.point_in_ring(c_lng, c_lat, wb)
    def way(i: int, tags: dict, geometry: list[dict]) -> dict:
        return {"type": "way", "id": i, "tags": {"building": "yes", **tags}, "geometry": geometry}

    payload = {
        "elements": [
            way(1, {"height": "120", "name": "Tower A"}, _square(c_lng, c_lat)),
            way(2, {"building:levels": "60"}, _square(c_lng + 0.002, c_lat)),
            way(3, {"height": "12"}, _square(c_lng, c_lat)),  # too low
            way(4, {"height": "80"}, _square(51.20, 25.05)),  # outside every zone
            {"type": "node", "id": 5, "tags": {"height": "500"}},
        ]
    }
    feats = buildings.overpass_to_features(payload, zones)
    assert [f["properties"]["osm_id"] for f in feats] == [2, 1, 4]  # tallest first, 3 dropped, node ignored
    by_id = {f["properties"]["osm_id"]: f["properties"] for f in feats}
    assert by_id[1]["zone_id"] == "west_bay" and by_id[1]["name"] == "Tower A"
    assert by_id[2]["levels"] == 60 and by_id[2]["height_m"] == 60 * buildings.LEVEL_HEIGHT_M
    assert by_id[4]["zone_id"] is None
    ring = feats[0]["geometry"]["coordinates"][0]
    assert ring[0] == ring[-1]


def test_api_serves_empty_then_file(tmp_path, monkeypatch):
    monkeypatch.setattr(api_buildings, "PATH", tmp_path / "missing.geojson")
    client = TestClient(app)  # ungated route: works before the database is ready
    r = client.get("/api/buildings")
    assert r.status_code == 200 and r.json()["features"] == [] and r.json()["properties"]["available"] is False

    path = tmp_path / "doha_buildings.geojson"
    feature = {
        "type": "Feature",
        "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]},
        "properties": {"osm_id": 9, "height_m": 50, "zone_id": None},
    }
    path.write_text(json.dumps(buildings.collection([feature])))
    monkeypatch.setattr(api_buildings, "PATH", path)
    r = client.get("/api/buildings").json()
    assert r["properties"]["count"] == 1 and r["features"][0]["properties"]["osm_id"] == 9
