#!/usr/bin/env python3
"""Build Super SAGE Historical Lab V2 play-level corpus."""
from __future__ import annotations
import argparse,json
from pathlib import Path
import pandas as pd

PBP="https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{season}.csv.gz"
KEEP=[
"play_id","game_id","season","week","posteam","defteam","home_team","away_team",
"qtr","down","ydstogo","yardline_100","game_seconds_remaining","score_differential",
"play_type","pass","rush","qb_dropback","complete_pass","incomplete_pass","interception",
"pass_attempt","rush_attempt","sack","qb_scramble","air_yards","yards_after_catch",
"passing_yards","receiving_yards","rushing_yards","yards_gained","touchdown",
"pass_touchdown","rush_touchdown","receiver_player_id","receiver_player_name",
"passer_player_id","passer_player_name","rusher_player_id","rusher_player_name",
"shotgun","no_huddle","play_action","goal_to_go","two_point_attempt",
"third_down_converted","fourth_down_converted","epa","wpa","success",
"cp","cpoe","xyac_epa","xyac_mean_yardage"
]

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--start",type=int,default=2016)
    ap.add_argument("--end",type=int,default=2026)
    ap.add_argument("--end-2026-week",type=int,default=3)
    ap.add_argument("--out",default="data/sage-historical-lab-v2")
    a=ap.parse_args(); out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
    frames=[]; season_rows={}
    for season in range(a.start,a.end+1):
        d=pd.read_csv(PBP.format(season=season),compression="gzip",low_memory=False)
        d["season"]=pd.to_numeric(d["season"],errors="coerce")
        d["week"]=pd.to_numeric(d["week"],errors="coerce")
        if "season_type" in d.columns:d=d[d.season_type.astype(str).str.upper().eq("REG")]
        if season==2026:d=d[d.week<=a.end_2026_week]
        cols=[c for c in KEEP if c in d.columns]
        d=d[cols].copy()
        season_rows[str(season)]=int(len(d))
        frames.append(d)
    pbp=pd.concat(frames,ignore_index=True,sort=False)
    pbp.to_csv(out/"plays.csv.gz",index=False,compression="gzip")
    manifest={
      "version":2,"source":"nflverse pbp","startSeason":a.start,"endSeason":a.end,
      "end2026Week":a.end_2026_week,"plays":int(len(pbp)),
      "games":int(pbp.game_id.nunique()),"seasonRows":season_rows,
      "columns":list(pbp.columns),
      "lookAheadRule":"Same-week outcomes are forbidden as pre-decision features in replay."
    }
    (out/"manifest.json").write_text(json.dumps(manifest,indent=2)+"\n")
    print(json.dumps(manifest,indent=2))
if __name__=="__main__":main()
