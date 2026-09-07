"""Protocol RAG over `protocol_chunks` (the fictional EN/AR civil-defence corpus seeded in Phase 1).

Retrieval: pgvector cosine search on Gemini embeddings (`gemini-embedding-001`, 768 dims) when the
chunks have been embedded; otherwise Postgres keyword search, honestly labelled in `method`.
GCP swap: Vertex AI Search over the same documents.
"""

from __future__ import annotations

import re
from typing import Any

from ..config import get_settings
from ..db import query, query_one

EMBED_MODEL = "gemini-embedding-001"
DIMS = 768
_TOKEN = re.compile(r"[\w؀-ۿ]{3,}")


def embeddings_available(lang: str) -> bool:
    row = query_one("SELECT count(*) AS n FROM protocol_chunks WHERE lang = %s AND embedding IS NOT NULL", (lang,))
    return bool(row and row["n"] > 0)


def _client():
    from google import genai

    return genai.Client(api_key=get_settings().gemini_api_key)


def embed_texts(texts: list[str], task_type: str) -> list[list[float]]:
    from google.genai import types

    client = _client()
    out: list[list[float]] = []
    for i in range(0, len(texts), 100):
        resp = client.models.embed_content(
            model=EMBED_MODEL,
            contents=texts[i : i + 100],
            config=types.EmbedContentConfig(task_type=task_type, output_dimensionality=DIMS),
        )
        out.extend([list(e.values) for e in resp.embeddings])
    return out


def embed_corpus() -> int:
    """Embed every chunk that has no embedding yet. Needs GEMINI_API_KEY; the seed calls this when it can."""
    from ..db import connection

    rows = query("SELECT id, doc_title, section, content FROM protocol_chunks WHERE embedding IS NULL ORDER BY id")
    if not rows:
        return 0
    vectors = embed_texts([f"{r['doc_title']} — {r['section']}\n{r['content']}" for r in rows], "RETRIEVAL_DOCUMENT")
    with connection() as conn, conn.cursor() as cur:
        cur.executemany(
            "UPDATE protocol_chunks SET embedding = %s::vector WHERE id = %s",
            [("[" + ",".join(f"{v:.6f}" for v in vec) + "]", r["id"]) for r, vec in zip(rows, vectors, strict=True)],
        )
        conn.commit()
    return len(rows)


def _hit(r: dict, score: float) -> dict[str, Any]:
    return {
        "doc_id": r["doc_id"],
        "doc_title": r["doc_title"],
        "doc_version": r["doc_version"],
        "section_no": r["section_no"],
        "section": r["section"],
        "lang": r["lang"],
        "content": r["content"][:900],
        "score": round(float(score), 4),
    }


def search_protocols(query_text: str, lang: str = "en", k: int = 4) -> dict[str, Any]:
    lang = "ar" if lang == "ar" else "en"
    if get_settings().gemini_api_key and embeddings_available(lang):
        try:
            vec = embed_texts([query_text], "RETRIEVAL_QUERY")[0]
            rows = query(
                "SELECT doc_id, doc_title, doc_version, section_no, section, lang, content, "
                "1 - (embedding <=> %s::vector) AS score FROM protocol_chunks "
                "WHERE lang = %s AND embedding IS NOT NULL ORDER BY embedding <=> %s::vector LIMIT %s",
                ("[" + ",".join(f"{v:.6f}" for v in vec) + "]", lang, "[" + ",".join(f"{v:.6f}" for v in vec) + "]", k),
            )
            return {
                "method": "pgvector",
                "model": EMBED_MODEL,
                "lang": lang,
                "hits": [_hit(r, r["score"]) for r in rows],
            }
        except Exception as exc:  # noqa: BLE001 — degrade to keywords rather than fail the answer
            print(f"[rag] embedding search failed ({exc}); keyword fallback", flush=True)
    rows = query(
        "SELECT doc_id, doc_title, doc_version, section_no, section, lang, content, "
        "ts_rank_cd(to_tsvector('simple', doc_title || ' ' || section || ' ' || content), "
        "plainto_tsquery('simple', %s)) AS score "
        "FROM protocol_chunks WHERE lang = %s "
        "AND to_tsvector('simple', doc_title || ' ' || section || ' ' || content) @@ plainto_tsquery('simple', %s) "
        "ORDER BY score DESC LIMIT %s",
        (query_text, lang, query_text, k),
    )
    if not rows:  # last resort: any chunk mentioning any query token
        tokens = [t.lower() for t in _TOKEN.findall(query_text)][:6]
        if tokens:
            clauses = " OR ".join(["lower(content) LIKE %s"] * len(tokens))
            rows = query(
                f"SELECT doc_id, doc_title, doc_version, section_no, section, lang, content, 0.1 AS score "
                f"FROM protocol_chunks WHERE lang = %s AND ({clauses}) ORDER BY id LIMIT %s",
                [lang, *[f"%{t}%" for t in tokens], k],
            )
    return {"method": "keyword", "model": None, "lang": lang, "hits": [_hit(r, r["score"]) for r in rows]}
