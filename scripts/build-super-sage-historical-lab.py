#!/usr/bin/env python3
"""Super SAGE Historical Lab V1 importer.

Volume-first, relevance-first baseline:
  2019-2025 full regular seasons + 2026 Weeks 1-3.

Uses nflverse weekly player stats and schedules. Raw PBP is intentionally
Phase 2 after this player-week baseline validates cleanly.
"""

from __future__ import annotations
import argparse, json
from pathlib import Path
import pandas as pd

BASE = "https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats.csv"
SCHEDULE = "https://github.com/nflverse/nfldata/raw/master/data/games.csv"

def fantasy_points(df: pd.DataFrame) -> pd.DataFrame:
    def col(name):
        return pd.to_numeric(df[name], errors="coerce").fillna(0) if name in df else 0
    passing = col("passing_yards") / 25 + col("passing_tds") * 4 - col("interceptions") * 2
    rushing = col("rushing_yards") / 10 + col("rushing_tds") * 6
    receiving = col("receiving_yards") / 10 + col("receiving_tds") * 6
    misc = -col("rushing_fumbles_lost") * 2 - col("receiving_fumbles_lost") * 2 - col("sack_fumbles_lost") * 2
    base = passing + rushing + receiving + misc
    rec = col("receptions")
    df["fantasy_std"] = base.round(2)
    df["fantasy_half_ppr"] = (base + rec * 0.5).round(2)
    df["fantasy_ppr"] = (base + rec).round(2)
    return df

def build(start=2019, end=2026, end_2026_week=3):
    stats = pd.read_csv(BASE, low_memory=False)
    stats["season"] = pd.to_numeric(stats["season"], errors="coerce")
    stats["week"] = pd.to_numeric(stats["week"], errors="coerce")
    keep = stats["season"].between(start, end)
    keep &= (stats["season"] < 2026) | (stats["week"] <= end_2026_week)
    stats = stats.loc[keep].copy()
    if "season_type" in stats:
        stats = stats.loc[stats["season_type"].astype(str).str.upper().eq("REG")].copy()

    stats = fantasy_points(stats)

    wanted = [
        "season","week","player_id","player_name","player_display_name",
        "position","position_group","recent_team","opponent_team",
        "completions","attempts","passing_yards","passing_tds","interceptions",
        "carries","rushing_yards","rushing_tds",
        "targets","receptions","receiving_yards","receiving_tds",
        "rushing_fumbles_lost","receiving_fumbles_lost","sack_fumbles_lost",
        "fantasy_std","fantasy_half_ppr","fantasy_ppr"
    ]
    cols = [c for c in wanted if c in stats.columns]
    out = stats[cols].copy()

    schedule = pd.read_csv(SCHEDULE, low_memory=False)
    schedule["season"] = pd.to_numeric(schedule["season"], errors="coerce")
    schedule["week"] = pd.to_numeric(schedule["week"], errors="coerce")
    sched = schedule.loc[
        schedule["season"].between(start, end)
        & ((schedule["season"] < 2026) | (schedule["week"] <= end_2026_week))
    ].copy()
    if "game_type" in sched:
        sched = sched.loc[sched["game_type"].astype(str).eq("REG")].copy()

    meta = {
        "version": 1,
        "source": "nflverse",
        "window": {"startSeason": start, "endSeason": end, "end2026Week": end_2026_week},
        "playerWeekRows": int(len(out)),
        "seasons": sorted(int(x) for x in out["season"].dropna().unique()),
        "weeksBySeason": {
            str(int(s)): sorted(int(x) for x in g["week"].dropna().unique())
            for s, g in out.groupby("season")
        },
        "games": int(len(sched)),
        "licenseNote": "Preserve nflverse dataset provenance/attribution. See Historical Lab design doc.",
        "lookAheadRule": "Outcomes may never be exposed as pre-decision features in historical replay."
    }
    return out, sched, meta

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--out", default="data/sage-historical-lab")
    p.add_argument("--start", type=int, default=2019)
    p.add_argument("--end", type=int, default=2026)
    p.add_argument("--end-2026-week", type=int, default=3)
    args = p.parse_args()
    outdir = Path(args.out); outdir.mkdir(parents=True, exist_ok=True)
    players, schedule, meta = build(args.start, args.end, args.end_2026_week)
    # CSV is the portable baseline artifact; Parquet can be added later as an optimized representation.\n    players.to_csv(outdir / "player-weeks.csv", index=False)\n    schedule.to_csv(outdir / "games.csv", index=False)
    (outdir / "manifest.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(json.dumps(meta, indent=2))

if __name__ == "__main__":
    main()
