"""Rafid — the ADK agent on Gemini, and the event stream the panel renders.

Tools (CLAUDE.md §8): the situational `db` toolset (MCP Toolbox for Databases when its server is up,
the same queries as local tools otherwise), the custom flood-forecasting-mcp (stdio subprocess),
`score_zone`, `search_protocols`, `propose_dispatch_plan`, `draft_advisory`.

"The LLM never makes the consequential decision. The rules engine decides; the agent explains,
proposes, and cites. Everything is logged."
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from collections.abc import AsyncIterator
from typing import Any

import httpx

from ..config import get_settings
from ..models import get_registry
from . import rag, tools
from .context import TURN, Turn

APP_NAME = "sadd"
TOOLBOX_URL = os.environ.get("TOOLBOX_URL", "http://127.0.0.1:5000")
TOOLBOX_TOOLSET = "sadd"

INSTRUCTION = """You are Rafid (رافد — "tributary; one who supports"), the operations analyst of the Doha Flood
Operations Center, a fictional demo persona. The operator is watching a replay of the April 2024 storm or the
live feed; every message starts with a [context] line giving the current replay tick, the local time and the
interface language.

How you work
- Ground every statement in tool results. Call tools before answering questions about zones, alerts, KPIs,
  assets, gauges or protocols. If a tool returns nothing, say the data is missing — never invent numbers,
  gauge readings, rule ids or protocol sections.
- "Now" means the replay tick in the [context] line; tools default to it. When the operator asks about a
  clock time (e.g. "14:00"), convert it to a tick: tick = minutes since 15 April 2024 00:00 Doha ÷ 10.
- For gauge status use the flood tools with as_of set to the RFC 3339 time in the [context] line.
- Cite protocols as [DOC-ID §n] using doc_id and section_no from search_protocols, and quote the section
  title. Say the documents are fictional training documents if asked.
- Answer in the language the operator wrote in (Arabic or English). If unclear, use the interface language.
- You never execute anything. A dispatch plan is a proposal: call propose_dispatch_plan, present the
  allocation and the expected time-to-drain and damage deltas, and say the operator's APPROVE is required;
  rule R-05 validates and applies it. Advisories are DRAFTS for operator review — label them DRAFT.
- Style: calm, precise, operational. No emojis. Lead with the answer, then the evidence, then the
  recommended next step. Numbers carry units. Keep it under ~180 words unless asked for detail.
"""

_agent = None
_runner = None
_session_service = None
_db_source = "local"


def toolbox_reachable() -> bool:
    try:
        r = httpx.get(f"{TOOLBOX_URL}/", timeout=1.5)
        return r.status_code < 500
    except Exception:  # noqa: BLE001
        return False


def _build():
    """Create the agent and runner once. Imports ADK lazily so the API boots even if ADK is missing."""
    global _agent, _runner, _session_service, _db_source
    from google.adk.agents import LlmAgent
    from google.adk.runners import Runner
    from google.adk.sessions import InMemorySessionService
    from google.adk.tools.mcp_tool import McpToolset, StdioConnectionParams
    from mcp import StdioServerParameters

    s = get_settings()
    os.environ.setdefault("GOOGLE_API_KEY", s.gemini_api_key)
    os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "FALSE")

    flood = McpToolset(
        connection_params=StdioConnectionParams(
            server_params=StdioServerParameters(
                command=sys.executable,
                args=["-m", "flood_forecasting_mcp.server"],
                env={**os.environ, "DATABASE_URL": s.database_url, "FLOOD_MCP_BACKEND": s.flood_mcp_backend},
            ),
            timeout=20.0,
        ),
        tool_name_prefix="flood",
    )
    if toolbox_reachable():
        from google.adk.tools.toolbox_toolset import ToolboxToolset

        db_tools: list[Any] = [tools.get_replay_context, ToolboxToolset(TOOLBOX_URL, toolset_name=TOOLBOX_TOOLSET)]
        _db_source = "toolbox"
    else:
        db_tools = list(tools.LOCAL_DB_TOOLS)
        _db_source = "local"

    _agent = LlmAgent(
        name="rafid",
        model=s.gemini_model,
        description=(
            "Flood operations analyst: situational Q&A, scoring, protocol citations, plan proposals, advisory drafts."
        ),
        instruction=INSTRUCTION,
        tools=[*db_tools, *tools.LOCAL_TOOLS, flood],
    )
    _session_service = InMemorySessionService()
    _runner = Runner(app_name=APP_NAME, agent=_agent, session_service=_session_service)
    print(
        f"[rafid] agent ready · model {s.gemini_model} · db tools via {_db_source} · flood-forecasting-mcp (stdio)",
        flush=True,
    )


def status() -> dict:
    s = get_settings()
    online = bool(s.gemini_api_key)
    return {
        "name": "Rafid",
        "name_ar": "رافد",
        "online": online,
        "phase": 3,
        "gemini_key_present": online,
        "model": s.gemini_model,
        "tools": {
            "db": _db_source if _runner else ("toolbox" if toolbox_reachable() else "local"),
            "toolbox_url": TOOLBOX_URL,
            "flood_mcp": {"transport": "stdio", "backend": s.flood_mcp_backend},
            "rag": "pgvector" if (online and _safe(lambda: rag.embeddings_available("en"))) else "keyword",
            "models": get_registry().risk_source,
        },
        "notice_en": ""
        if online
        else "Rafid needs GEMINI_API_KEY. Set it and redeploy; the panel stays a shell until then.",
        "notice_ar": ""
        if online
        else "يحتاج رافد إلى GEMINI_API_KEY. أضفه وأعد النشر؛ تبقى اللوحة هيكلاً حتى ذلك الحين.",
    }


def _safe(fn):
    try:
        return fn()
    except Exception:  # noqa: BLE001
        return False


def _summary(name: str, resp: Any) -> str:
    """One line per tool result for the visible trace (the builders in the room must SEE the calls)."""
    try:
        r = resp if isinstance(resp, dict) else {}
        if "result" in r and isinstance(r["result"], dict):
            r = r["result"]
        if "error" in r:
            return f"error: {r['error']}"
        if name == "search_protocols":
            return f"{len(r.get('hits', []))} sections via {r.get('method')}"
        if name == "propose_dispatch_plan":
            return f"plan {r.get('plan_id')} · {sum(r.get('allocations', {}).values())} trucks · awaiting approval"
        if name == "score_zone":
            return f"risk {r.get('risk')} ({r.get('band')}) · {r.get('source')}"
        if name == "draft_advisory":
            return f"DRAFT {r.get('severity')} advisory · {r.get('chars_en')}/{r.get('chars_ar')} chars"
        if "count" in r:
            return f"{r['count']} rows"
        if "floodStatuses" in r:
            return ", ".join(f"{x['gaugeId']}={x['severity']}" for x in r["floodStatuses"][:4]) or "no statuses"
        if "gauges" in r:
            return f"{len(r['gauges'])} gauges"
        if "forecasts" in r:
            return f"forecasts for {len(r['forecasts'])} gauge(s)"
        return json.dumps(r, default=str)[:120]
    except Exception:  # noqa: BLE001
        return ""


def _events_from_result(name: str, resp: Any) -> list[dict]:
    """Structured side-channels the panel renders: citations, plans, drafts."""
    r = resp if isinstance(resp, dict) else {}
    if "result" in r and isinstance(r["result"], dict):
        r = r["result"]
    out: list[dict] = []
    if name == "search_protocols" and r.get("hits"):
        out.append(
            {
                "type": "citations",
                "method": r.get("method"),
                "items": [
                    {
                        "doc_id": h["doc_id"],
                        "doc_title": h["doc_title"],
                        "section_no": h["section_no"],
                        "section": h["section"],
                        "lang": h["lang"],
                    }
                    for h in r["hits"]
                ],
            }
        )
    if name == "propose_dispatch_plan" and r.get("plan_id"):
        out.append({"type": "plan", "plan": r})
    if name == "draft_advisory" and r.get("status") == "DRAFT":
        out.append({"type": "draft", "draft": r})
    return out


async def stream(session_id: str, user_id: str, message: str, turn: Turn) -> AsyncIterator[dict]:
    """Run one user turn and yield panel events: tool_call, tool_result, citations, plan, draft, text, done."""
    s = get_settings()
    if not s.gemini_api_key:
        yield {"type": "text", "delta": status()["notice_ar" if turn.lang == "ar" else "notice_en"]}
        yield {"type": "done", "offline": True}
        return
    if _runner is None:
        await asyncio.to_thread(_build)
    assert _runner is not None and _session_service is not None
    from google.adk.agents.run_config import RunConfig, StreamingMode
    from google.genai import types

    TURN.set(turn)
    if await _session_service.get_session(app_name=APP_NAME, user_id=user_id, session_id=session_id) is None:
        await _session_service.create_session(app_name=APP_NAME, user_id=user_id, session_id=session_id)
    ctx = (
        f"[context: mode={turn.mode}; replay tick {turn.tick}; local time {turn.ts_local}; "
        f"as_of={turn.ts_iso}; interface language={turn.lang}]"
    )
    content = types.Content(role="user", parts=[types.Part(text=f"{ctx}\n{message}")])
    streamed_text = False
    try:
        async for ev in _runner.run_async(
            user_id=user_id,
            session_id=session_id,
            new_message=content,
            run_config=RunConfig(streaming_mode=StreamingMode.SSE),
        ):
            c = getattr(ev, "content", None)
            parts = list(c.parts) if c and c.parts else []
            for p in parts:
                fc = getattr(p, "function_call", None)
                if fc is not None:
                    streamed_text = False
                    yield {"type": "tool_call", "name": fc.name, "args": dict(fc.args or {})}
                fr = getattr(p, "function_response", None)
                if fr is not None:
                    yield {"type": "tool_result", "name": fr.name, "summary": _summary(fr.name, fr.response)}
                    for extra in _events_from_result(fr.name, fr.response):
                        yield extra
            text = "".join(p.text for p in parts if getattr(p, "text", None) and not getattr(p, "thought", False))
            if text:
                if getattr(ev, "partial", False):
                    streamed_text = True
                    yield {"type": "text", "delta": text}
                elif not streamed_text:
                    yield {"type": "text", "delta": text}
                else:
                    streamed_text = False  # the final aggregate of what we already streamed
            err = getattr(ev, "error_message", None)
            if err:
                yield {"type": "error", "message": str(err)}
    except Exception as exc:  # noqa: BLE001 — the panel shows the error instead of hanging
        yield {"type": "error", "message": f"{type(exc).__name__}: {exc}"}
    yield {"type": "done"}
