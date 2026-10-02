#!/usr/bin/env python3
from __future__ import annotations
import argparse, json
from pathlib import Path
import numpy as np
import pandas as pd

FANTASY_POSITIONS = {"QB","RB","WR","TE","K"}

def audit(root: Path):
    p=pd.read_csv(root/"player-weeks.csv", low_memory=False)
    g=pd.read_csv(root/"games.csv", low_memory=False)
    m=json.loads((root/"manifest.json").read_text())
    key=[c for c in ["season","week","player_id","recent_team"] if c in p.columns]
    fantasy=p[p["position"].isin(FANTASY_POSITIONS)].copy()
    half_ok=np.isclose(p["fantasy_half_ppr"], p["fantasy_std"] + .5*p["receptions"].fillna(0), atol=.011)
    ppr_ok=np.isclose(p["fantasy_ppr"], p["fantasy_std"] + p["receptions"].fillna(0), atol=.011)
    report={
      "status":"PASS",
      "allPlayerWeekRows":int(len(p)),
      "fantasyPlayerWeekRows":int(len(fantasy)),
      "games":int(len(g)),
      "seasons":sorted(int(x) for x in p.season.unique()),
      "weekBounds":{str(int(s)):{"min":int(x.week.min()),"max":int(x.week.max()),"rows":int(len(x))} for s,x in p.groupby("season")},
      "duplicatePlayerWeekKeys":int(p.duplicated(subset=key).sum()),
      "missingPlayerIdsAll":int(p.player_id.isna().sum()),
      "missingPlayerIdsFantasy":int(fantasy.player_id.isna().sum()),
      "missingPlayerNamesFantasy":int(fantasy.player_name.isna().sum()),
      "nullFantasyScores":int(p[["fantasy_std","fantasy_half_ppr","fantasy_ppr"]].isna().sum().sum()),
      "halfPprArithmeticFailures":int((~half_ok).sum()),
      "pprArithmeticFailures":int((~ppr_ok).sum()),
      "fantasyPositionRows":{str(k):int(v) for k,v in fantasy.position.value_counts().to_dict().items()},
      "experimentalSplit":{
        "discovery":[2019,2020,2021,2022],
        "validation":[2023],
        "holdout":[2024,2025],
        "prospective":[2026]
      },
      "rules":[
        "2024-2025 holdout must not be used to choose/tune a hypothesis.",
        "2026 is prospective/current evidence and must remain isolated from discovery.",
        "Outcome columns are never legal pre-decision features.",
        "Fantasy-learning baseline uses QB/RB/WR/TE/K; DST requires a team-level dataset."
      ]
    }
    assert report["seasons"]==list(range(2019,2027))
    assert report["weekBounds"]["2026"]["max"]==3
    assert report["duplicatePlayerWeekKeys"]==0
    assert report["missingPlayerIdsFantasy"]==0
    assert report["missingPlayerNamesFantasy"]==0
    assert report["nullFantasyScores"]==0
    assert report["halfPprArithmeticFailures"]==0
    assert report["pprArithmeticFailures"]==0
    return report, fantasy

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--root",default="data/sage-historical-lab")
    args=ap.parse_args()
    root=Path(args.root)
    report,fantasy=audit(root)
    (root/"audit-report.json").write_text(json.dumps(report,indent=2)+"\n")
    fantasy.to_csv(root/"fantasy-player-weeks.csv",index=False)
    print(json.dumps(report,indent=2))

if __name__=="__main__":
    main()
