"""DETERMINISTIC decision engine.

This package is the ONLY component allowed to create alerts, action items or dispatches.
Rules are versioned pure functions (`rules.py`); the engine (`engine.py`) runs them over a
timeline and emits alert + decision_log records. No LLM is ever in this call path.
"""

from .engine import EngineOutput, evaluate_timeline  # noqa: F401
from .rules import RULES, Decision, Rule, RuleInputs, catalog, get_rule  # noqa: F401
