"""Risk-lit towers — OpenStreetMap footprints with heights (see sadd/buildings.py)."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter

from ..config import DATA_DIR

router = APIRouter(prefix="/api/buildings", tags=["buildings"])

PATH = DATA_DIR / "geojson" / "doha_buildings.geojson"
EMPTY = {"type": "FeatureCollection", "features": [], "properties": {"available": False, "count": 0}}
_cache: tuple[Path, float, dict] | None = None


@router.get("")
def list_buildings() -> dict:
    """Static GeoJSON, cached by file mtime. Empty (not an error) when nothing was fetched."""
    global _cache
    path = Path(PATH)
    if not path.is_file():
        return EMPTY
    mtime = path.stat().st_mtime
    if _cache is None or _cache[0] != path or _cache[1] != mtime:
        _cache = (path, mtime, json.loads(path.read_text(encoding="utf-8")))
    return _cache[2]
