# models/ — arrives in Phase 2

* `train.py` — generates ~5k rows from the physics_v0 generator (`sadd.sim.physics`),
  trains the XGBoost risk nowcast and the gradient-boosted time-to-drain regressor,
  saves both with joblib into `artifacts/` (git-ignored).
* `serve.py` — loads the artifacts once; `score_zone()` and `time_to_drain()` used by
  `/api/sim` and the Rafid tool `score_zone`.

Phase 1 already exposes the transparent baseline and its feature contributions so the
zone card's "why" explanation works before the model exists.
