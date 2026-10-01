# Super SAGE Historical Lab V1 — Data Access Decision

Status: GO

## Verified accessible datasets

Primary historical backbone: nflverse / nflreadpy.

Target window:
- 2024 full regular season
- 2025 full regular season
- 2026 Weeks 1-3 initially
- append each completed 2026 week

Datasets:
- play-by-play
- weekly player stats
- weekly team stats
- schedules/results
- weekly rosters
- snap counts
- injuries/practice status
- Next Gen Stats passing/receiving/rushing
- FTN charting where release timing/license permits
- fantasy rankings/opportunity datasets where license/use is appropriate

## Licensing / attribution

nflreadpy is MIT. nflverse documentation states the majority of distributed data is CC-BY 4.0; FTN-derived data is CC-BY-SA 4.0 and requires attribution. Preserve dataset-level license/provenance metadata in every historical build.

## Historical-lab principles

1. No look-ahead: a Week N replay may only use evidence available before the decision cutoff for Week N.
2. Outcomes are stored separately from pre-decision features.
3. Calculate Inner Sanctum fantasy outcomes ourselves for Standard, Half-PPR and PPR from underlying stats.
4. Preserve raw source IDs so anomalous player-weeks can be traced to games/plays.
5. Never overwrite prior-season historical evidence during season rollover.
6. Advanced/participation data with delayed release cannot be used as if it were available in-season.
7. Backtests must distinguish data availability today from data availability at the historical decision time.

## V1 canonical player-week schema

season, week, player_id, player_name, position, team, opponent,
game_id, home_away,
pass_attempts, completions, pass_yards, pass_td, interceptions,
carries, rush_yards, rush_td,
targets, receptions, rec_yards, rec_td,
fumbles_lost,
snaps, snap_pct,
fantasy_std, fantasy_half_ppr, fantasy_ppr,
injury_status_preweek,
source_generated_at,
outcome_finalized_at

Advanced fields are additive and source-scoped.

## Next build

Create a reproducible importer that downloads 2024/2025/2026 data, filters 2026 to completed Weeks 1-3 for the first baseline, computes fantasy scoring, validates row/game counts, and writes a versioned Historical Lab cache/artifact. No production ranking mutation.
