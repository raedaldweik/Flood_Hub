"""Trained models (CLAUDE.md §6): XGBoost risk nowcast + gradient-boosted time-to-drain.

`python -m sadd.models.train` reproduces both in well under a minute; `serve.get_registry()`
loads them once and falls back to the physics baseline, honestly labelled, when they are absent.
"""

from .serve import Registry, get_registry  # noqa: F401
