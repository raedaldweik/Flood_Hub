# models/ — the two trained models (CLAUDE.md §6)

| Model | Algorithm | Features | Label generator | Holdout |
|---|---|---|---|---|
| Risk nowcast `xgb_nowcast_v1` | XGBoost regressor (400 trees, depth 4) | rain mm/h, 3 h accumulation, drainage capacity, imperviousness, elevation, underpass | `physics_v0` runoff formula + noise | R² ≈ 0.98, MAE ≈ 2.6 pts |
| Time-to-drain `gbr_ttd_v1` | scikit-learn GradientBoostingRegressor (log target) | hotspot volume m³, pump m³/h, local drainage m³/h, inflow m³/h, net rate | `hours = volume ÷ (pumps + drainage − inflow)`, capped 48 h, + noise | R² ≈ 0.99, MAE ≈ 0.7 h |

* `train.py` — `python -m sadd.models.train` (or `make train`): generates ~6k + 5k rows, trains both,
  writes `backend/artifacts/*.joblib` + `metadata.json` in a few seconds. The Docker build runs it.
* `serve.py` — `get_registry()` loads the artifacts once. `risk_score()` is a drop-in for
  `physics.risk_score` (the seed passes it to the replay), `risk_contributions()` returns TreeSHAP
  per-feature points for the zone card, `time_to_drain()` feeds the what-if engine.
* `features.py` — one place for feature order and the hotspot geometry (an underpass basin of
  8,000 m², a street basin of 25,000 m²) that makes pump trucks matter where water collects.

Honesty: with no artifacts every call falls back to the transparent formulas and reports
`source: physics_v0`; the UI shows which one produced the explanation.

GCP: both become **BigQuery ML** models (`CREATE MODEL ... OPTIONS(model_type='BOOSTED_TREE_REGRESSOR')`)
over the same generated tables, scored through the managed BigQuery MCP server; explanations via
`ML.EXPLAIN_PREDICT`.
