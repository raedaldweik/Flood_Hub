"""Risk-lit towers: OpenStreetMap building footprints with heights for central Doha.

Google's photorealistic mesh does not cover Qatar, so the 3D map gets its building volume from
OpenStreetMap instead: every footprint with a height (or a level count) inside the central-Doha
bounding box, extruded on the Map3DElement and lit by the risk of the zone it stands in.

Data © OpenStreetMap contributors, ODbL — the attribution is shown on the map.

Runs at Docker build time (Railway) and via `make buildings`. It never fails a build: offline it
leaves any previous file untouched and the API answers an empty collection when there is none.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

from .config import DATA_DIR

OVERPASS_SERVERS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
)
# south, west, north, east — Msheireb and the Corniche up through West Bay to The Pearl.
BBOX = (25.27, 51.49, 25.40, 51.58)
MIN_HEIGHT_M = 30.0  # towers only: a 400-polygon skyline stays smooth over screen share
LEVEL_HEIGHT_M = 3.4  # when OSM has a level count but no height
MAX_BUILDINGS = 400
OUT_PATH = DATA_DIR / "geojson" / "doha_buildings.geojson"
ZONES_PATH = DATA_DIR / "geojson" / "doha_zones.geojson"

QUERY = """[out:json][timeout:90];
(
  way["building"]["height"]({bbox});
  way["building"]["building:levels"]({bbox});
);
out body geom;"""

_NUM = re.compile(r"[-+]?\d*\.?\d+")


def log(msg: str) -> None:
    print(f"[buildings] {msg}", flush=True)


def parse_height(tags: dict) -> float | None:
    """`height=150`, `height=150 m`, `height=492 ft`, else `building:levels` × a storey height."""
    raw = tags.get("height") or tags.get("building:height")
    if raw:
        m = _NUM.search(str(raw))
        if m:
            value = float(m.group())
            if "ft" in str(raw).lower() or "'" in str(raw):
                value *= 0.3048
            if value > 0:
                return value
    levels = tags.get("building:levels")
    if levels:
        m = _NUM.search(str(levels))
        if m and float(m.group()) > 0:
            return float(m.group()) * LEVEL_HEIGHT_M
    return None


def parse_levels(tags: dict) -> int | None:
    m = _NUM.search(str(tags.get("building:levels", "")))
    return int(float(m.group())) if m else None


def point_in_ring(lng: float, lat: float, ring: list[list[float]]) -> bool:
    """Ray casting — zones are simple polygons, so no geometry library is needed."""
    inside = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        if (y1 > lat) != (y2 > lat):
            x_at = x1 + (lat - y1) * (x2 - x1) / (y2 - y1)
            if lng < x_at:
                inside = not inside
    return inside


def load_zone_rings(path: Path = ZONES_PATH) -> list[tuple[str, list[list[float]]]]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return [(f["properties"]["id"], f["geometry"]["coordinates"][0]) for f in data["features"]]


def zone_for(lng: float, lat: float, zones: list[tuple[str, list[list[float]]]]) -> str | None:
    for zone_id, ring in zones:
        if point_in_ring(lng, lat, ring):
            return zone_id
    return None


def overpass_to_features(payload: dict, zones: list[tuple[str, list[list[float]]]]) -> list[dict]:
    """Closed OSM ways with a usable height → GeoJSON polygons tagged with their zone, tallest first."""
    features: list[dict] = []
    for el in payload.get("elements", []):
        if el.get("type") != "way":
            continue
        geom = el.get("geometry") or []
        if len(geom) < 4:
            continue
        ring = [[round(p["lon"], 6), round(p["lat"], 6)] for p in geom]
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        tags = el.get("tags") or {}
        height = parse_height(tags)
        if height is None or height < MIN_HEIGHT_M:
            continue
        n = len(ring) - 1
        c_lng = sum(p[0] for p in ring[:-1]) / n
        c_lat = sum(p[1] for p in ring[:-1]) / n
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [ring]},
                "properties": {
                    "osm_id": el["id"],
                    "name": tags.get("name:en") or tags.get("name"),
                    "height_m": round(height, 1),
                    "levels": parse_levels(tags),
                    "zone_id": zone_for(c_lng, c_lat, zones),
                    "centroid": [round(c_lng, 6), round(c_lat, 6)],
                },
            }
        )
    features.sort(key=lambda f: -f["properties"]["height_m"])
    return features[:MAX_BUILDINGS]


def collection(features: list[dict]) -> dict:
    return {
        "type": "FeatureCollection",
        "features": features,
        "properties": {
            "available": bool(features),
            "count": len(features),
            "source": "© OpenStreetMap contributors (ODbL), via the Overpass API",
            "fetched_at": datetime.now(UTC).isoformat(timespec="seconds"),
            "bbox": list(BBOX),
            "min_height_m": MIN_HEIGHT_M,
        },
    }


def fetch_overpass(timeout_s: float = 120.0) -> dict:
    query = QUERY.format(bbox=",".join(str(v) for v in BBOX))
    last: Exception | None = None
    for url in OVERPASS_SERVERS:
        try:
            req = urllib.request.Request(
                url,
                data=("data=" + urllib.parse.quote(query)).encode(),
                headers={"User-Agent": "sadd-flood-twin/0.1 (demo; risk-lit towers layer)"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=timeout_s) as resp:  # noqa: S310 — fixed https hosts
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            last = exc
            log(f"{url} failed: {exc}")
    raise RuntimeError(f"all Overpass servers failed: {last}")


def run(out: Path = OUT_PATH, from_file: Path | None = None, strict: bool = False) -> int:
    try:
        zones = load_zone_rings()
        payload = json.loads(Path(from_file).read_text(encoding="utf-8")) if from_file else fetch_overpass()
        features = overpass_to_features(payload, zones)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(collection(features), ensure_ascii=False), encoding="utf-8")
        in_zone = sum(1 for f in features if f["properties"]["zone_id"])
        log(f"wrote {len(features)} towers ({in_zone} inside zones) → {out}")
        return 0
    except Exception as exc:  # noqa: BLE001 — a build must not fail because Overpass is busy
        log(f"failed: {exc}")
        if out.is_file():
            log(f"keeping the previous {out}")
        else:
            log("no towers file — the 3D map runs without the risk-lit layer")
        return 1 if strict else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("--out", type=Path, default=OUT_PATH)
    ap.add_argument("--from-file", type=Path, help="parse a saved Overpass JSON instead of fetching")
    ap.add_argument("--strict", action="store_true", help="exit non-zero on failure")
    a = ap.parse_args()
    sys.exit(run(a.out, a.from_file, a.strict))
