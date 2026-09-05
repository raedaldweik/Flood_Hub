"""Rafid status endpoint (Phase 1). The agent itself arrives in Phase 3."""

from __future__ import annotations

from fastapi import APIRouter

from ..config import get_settings

router = APIRouter(prefix="/api/agent", tags=["agent"])


@router.get("/status")
def status() -> dict:
    s = get_settings()
    return {
        "name": "Rafid",
        "name_ar": "رافد",
        "online": False,
        "phase": 3,
        "gemini_key_present": bool(s.gemini_api_key),
        "model": s.gemini_model,
        "notice_en": "Rafid comes online in Phase 3 (ADK + Gemini). Until then this panel is a shell.",
        "notice_ar": "يبدأ رافد العمل في المرحلة الثالثة (ADK + Gemini). حتى ذلك الحين هذه اللوحة هيكل فقط.",
    }
