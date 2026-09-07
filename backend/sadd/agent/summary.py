"""Rafid's one-line executive summary (CLAUDE.md §3, Tab 4).

Boring-reliable by design: the sentence is always produced from a template first; when a Gemini key is
present the model is asked to rewrite it in one sentence, with a short timeout, and the response says
which of the two you are looking at (`source`). Numbers never come from the model — only the wording.
"""

from __future__ import annotations

from ..config import get_settings

_cache: dict[tuple, dict] = {}


def _template(f: dict, lang: str) -> str:
    lead_h = f["alert_lead_time_min"] / 60.0
    avoided_m = f["avoided_damage_qar"] / 1e6
    if lang == "ar":
        return (
            f"هذه العاصفة: {f['alerts_total']} تنبيهاً في {f['zones_alerted']} مناطق، "
            f"متوسط مهلة إنذار {lead_h:.1f} ساعة، "
            f"وخلو كامل خلال {f['all_clear_h_sadd']:.1f} ساعة بدلاً من {f['all_clear_h_actual']:.1f}، "
            f"وأضرار مُتجنَّبة تقديرية بنحو {avoided_m:.1f} مليون ريال."
        )
    return (
        f"This storm: {f['alerts_total']} alerts across {f['zones_alerted']} zones, "
        f"{lead_h:.1f} h average alert lead time, all zones clear in {f['all_clear_h_sadd']:.1f} h instead of "
        f"{f['all_clear_h_actual']:.1f} h, and an estimated {avoided_m:.1f}M QAR of avoided damage."
    )


def _gemini(facts: dict, template: str, lang: str) -> str | None:
    s = get_settings()
    if not s.gemini_api_key:
        return None
    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=s.gemini_api_key, http_options=types.HttpOptions(timeout=8000))
        language = "Arabic" if lang == "ar" else "English"
        prompt = (
            "You are Rafid, the analyst of a fictional flood operations centre. Rewrite the sentence below as ONE "
            f"calm, precise sentence in {language} for a minister (max 45 words). Keep every number exactly as "
            "given; do not add numbers, claims, emojis or a preamble.\n\n"
            f"Facts: {facts}\n\nSentence: {template}"
        )
        resp = client.models.generate_content(
            model=s.gemini_model,
            contents=prompt,
            config=types.GenerateContentConfig(temperature=0.2, max_output_tokens=120),
        )
        text = (resp.text or "").strip().replace("\n", " ")
        return text if 20 < len(text) < 400 else None
    except Exception as exc:  # noqa: BLE001 — the template is the fallback, never an error page
        print(f"[rafid] executive summary via Gemini failed: {exc}", flush=True)
        return None


def executive_summary(facts: dict, lang: str, cache_key: tuple) -> dict:
    """{"text", "source": "gemini" | "template", "model"} — cached per seed + decision count so the tab is instant."""
    key = (*cache_key, lang)
    if key in _cache:
        return _cache[key]
    template = _template(facts, lang)
    text = _gemini(facts, template, lang)
    out = {
        "text": text or template,
        "source": "gemini" if text else "template",
        "model": get_settings().gemini_model if text else None,
    }
    _cache[key] = out
    return out
