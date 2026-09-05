from __future__ import annotations

from fastapi import APIRouter

from ..db import query
from .schemas import Asset, Depot

router = APIRouter(prefix="/api", tags=["assets"])


@router.get("/assets", response_model=list[Asset])
def list_assets() -> list[Asset]:
    return [Asset(**r) for r in query("SELECT * FROM assets ORDER BY type, id")]


@router.get("/depots", response_model=list[Depot])
def list_depots() -> list[Depot]:
    return [Depot(**r) for r in query("SELECT * FROM depots ORDER BY id")]
