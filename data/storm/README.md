# April 2024 replay — rainfall source

`make seed` first tries **Open-Meteo's historical archive** (ERA5-based reanalysis,
no API key) for hourly precipitation at Doha (25.2854 N, 51.5310 E) between
`REPLAY_START_DATE` and `REPLAY_END_DATE`. Rows loaded that way are labelled
`source = replay_2024`, `rain_source = open-meteo-archive` in `replay_meta`.

If the archive is unreachable at seed time (offline, proxy, rate-limit) the seed
falls back to `april_2024_doha_hourly_fallback.csv`: a **hand-designed synthetic
curve** (calm → build-up → ~4 h violent peak around midday on 16 April → taper).
It is shaped after public reporting of the 15–17 April 2024 Gulf storm but it is
NOT an observed record. The UI shows which source is active.

Historical context used in UI copy is always marked "approx., based on public
reports": the same system delivered roughly 250 mm in about 24 h to parts of the
UAE (its heaviest rainfall on record) and caused widespread flooding in Qatar.
Verify station totals with the national meteorology department before quoting.

## Calibration note (read before demo day)

The fallback curve peaks at ~24 mm/h with ~100 mm on 16 April (city average,
before per-zone spatial factors). ERA5 reanalysis smooths convective peaks over
a ~9 km grid cell, so the Open-Meteo archive may report lower hourly maxima than
what fell on individual districts. If the archive-driven replay looks too tame
for the narrative, set `SEED_FORCE_FALLBACK=1` and re-seed — the UI then labels
the rain source as the synthetic fallback. Never present either curve as an
official observation.
