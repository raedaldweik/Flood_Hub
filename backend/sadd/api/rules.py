"""Governance endpoints: the versioned rule catalog (with its pytest coverage) and the decision ledger."""

from __future__ import annotations

import ast
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, Query

from ..db import query
from ..rules import RULES, catalog

router = APIRouter(prefix="/api", tags=["governance"])

TESTS_DIR = Path(__file__).resolve().parents[2] / "tests"
GATE_RULES = {"R-05", "R-08"}  # validated on demand (approve / stand-down), not evaluated on the timeline


@lru_cache
def _test_counts() -> dict[str, int]:
    """How many pytest functions exercise each rule — counted from the test sources, so the number on the
    Governance tab is the number in the repo (README: "unit tests for every rule")."""
    counts = {r.id: 0 for r in RULES}
    class_names = {r.id: type(r).__name__ for r in RULES}
    if not TESTS_DIR.is_dir():
        return counts
    for path in sorted(TESTS_DIR.glob("test_*.py")):
        try:
            src = path.read_text(encoding="utf-8")
            tree = ast.parse(src)
        except (OSError, SyntaxError):
            continue
        lines = src.splitlines()
        for node in ast.walk(tree):
            if not isinstance(node, ast.FunctionDef) or not node.name.startswith("test_"):
                continue
            body = "\n".join(lines[node.lineno - 1 : node.end_lineno or node.lineno])
            for rid in counts:
                slug = rid.lower().replace("-", "")  # test_r04_...
                if rid in body or class_names[rid] in body or slug in node.name:
                    counts[rid] += 1
    return counts


@router.get("/rules")
def rule_catalog() -> list[dict]:
    """Versioned, plain-language rule catalog — straight from the code that fires them, with test coverage."""
    tests = _test_counts()
    return [
        {**r, "kind": "gate" if r["id"] in GATE_RULES else "timeline", "test_count": tests.get(r["id"], 0)}
        for r in catalog()
    ]


@router.get("/decisions")
def decisions(
    limit: int = Query(500, le=5000),
    zone_id: str | None = None,
    rule_id: str | None = None,
    decision_type: str | None = None,
    proposed_by: str | None = None,
) -> list[dict]:
    """The decision ledger, newest first. Every row names the rule id + version, the exact inputs the rule saw,
    who proposed it (system / agent / operator) and who approved it."""
    sql = "SELECT * FROM decision_log WHERE TRUE"
    params: list = []
    for col, val in (
        ("zone_id", zone_id),
        ("rule_id", rule_id),
        ("decision_type", decision_type),
        ("proposed_by", proposed_by),
    ):
        if val:
            sql += f" AND {col} = %s"
            params.append(val)
    sql += " ORDER BY ts DESC, id DESC LIMIT %s"
    params.append(limit)
    return query(sql, params)
