# Historical Lab — Tonight's ingestion window

Chosen baseline: **2019 through 2025 full regular seasons + 2026 Weeks 1-3**.

Why not start with raw 2016-2026 PBP tonight?
- Weekly player stats produce the first useful learning corpus at a fraction of the volume.
- 2019-2026 spans the most relevant modern strategic transition.
- It validates identity, scoring, season/week boundaries and no-look-ahead architecture before raw PBP multiplies complexity.
- 2016-2018 and raw PBP remain Phase 2 expansions after baseline validation.

First artifact:
- player-weeks.parquet
- games.parquet
- manifest.json

The importer calculates Inner Sanctum Standard / Half-PPR / PPR outcomes from underlying weekly stats.

Raw play-by-play, NGS, injuries, snaps and advanced charting join by source-scoped additive passes; they do not block the baseline.
