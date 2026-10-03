#!/usr/bin/env python3
"""Super SAGE Turbine #5 V1 — State Transition / Role Redistribution.

Frozen hypothesis:
A material change in a player's share of team opportunity contains next-game
directional information beyond that player's recent fantasy production and
recent raw opportunity.

This is deliberately NOT an injury model. Historical V1 lacks a temporally
complete injury/depth-chart feed, so no injury cause is inferred. We measure
only observable opportunity-share transitions using information available
through the prior game.

Outcome: next-game Half-PPR direction versus the player's prior 3-game average.
Predictors are shifted; same-week outcomes are never predictors.
"""
from __future__ import annotations
import argparse,json
from pathlib import Path
import numpy as np
import pandas as pd

SPLITS={"discovery":[2019,2020,2021,2022],"validation":[2023],"holdout":[2024,2025],"prospective":[2026]}
POSITIONS=("RB","WR","TE")

def safe_div(a,b):
    return np.where(b>0,a/b,np.nan)

def build(df):
    d=df[df.position.isin(POSITIONS)].copy()
    for c in ("season","week","fantasy_half_ppr","carries","targets"):
        d[c]=pd.to_numeric(d[c],errors="coerce")
    team_col="recent_team" if "recent_team" in d.columns else "team"
    if team_col not in d.columns: raise KeyError("player-weeks missing team identity")
    d["team_key"]=d[team_col]
    d["opp"]=np.where(d.position.eq("RB"),d.carries.fillna(0),d.targets.fillna(0))
    team=d.groupby(["season","week","team_key","position"],dropna=False)["opp"].transform("sum")
    d["opp_share"]=safe_div(d.opp.to_numpy(float),team.to_numpy(float))
    d=d.sort_values(["season","player_id","week"])
    g=d.groupby(["season","player_id"],sort=False)
    d["fantasy_prev3"]=g.fantasy_half_ppr.transform(lambda s:s.shift(1).rolling(3,min_periods=2).mean())
    d["opp_prev3"]=g.opp.transform(lambda s:s.shift(1).rolling(3,min_periods=2).mean())
    d["share_prev1"]=g.opp_share.shift(1)
    d["share_prev3_prior"]=g.opp_share.transform(lambda s:s.shift(2).rolling(3,min_periods=2).mean())
    d["share_delta"]=d.share_prev1-d.share_prev3_prior
    d["actual_delta"]=d.fantasy_half_ppr-d.fantasy_prev3
    d["actual_direction"]=np.select([d.actual_delta>=2,d.actual_delta<=-2],[1,-1],default=0)
    d=d.dropna(subset=["fantasy_prev3","opp_prev3","share_delta","actual_delta"])

    # Freeze a material transition threshold from discovery only. Use the 80th
    # percentile absolute share change, never holdout outcomes.
    discovery=d[d.season.isin(SPLITS["discovery"])]
    thresholds={p:float(discovery.loc[discovery.position.eq(p),"share_delta"].abs().quantile(.80)) for p in POSITIONS}

    result={
      "experiment":"turbine-5-state-transition-v1",
      "frozenHypothesis":"A material change in player share of team opportunity contains next-game directional information beyond recent fantasy production and raw opportunity.",
      "causeInference":"NONE — V1 observes role-share transitions and does not infer injury/depth-chart cause.",
      "noLookAhead":True,
      "directionRule":"UP if next-game Half-PPR is >=2 above prior-3 average; DOWN if <=-2; otherwise STABLE.",
      "thresholdRule":"Material transition = absolute prior-game opportunity-share delta at or above discovery-only position 80th percentile.",
      "thresholds":thresholds,
      "productionBoundary":"Experiment only. No Weekly SAGE ranking change is authorized.",
      "splits":{}
    }
    for split,seasons in SPLITS.items():
        x=d[d.season.isin(seasons)]
        block={"n":int(len(x)),"positions":{}}
        for p in POSITIONS:
            z=x[x.position.eq(p)].copy(); t=thresholds[p]
            z["material"]=z.share_delta.abs()>=t
            z["pred_direction"]=np.sign(z.share_delta).astype(int)
            m=z[z.material]
            directional=m[m.actual_direction.ne(0)]
            accuracy=None if len(directional)==0 else float((directional.pred_direction==directional.actual_direction).mean())
            up=m[m.share_delta.gt(0)]; down=m[m.share_delta.lt(0)]
            block["positions"][p]={
              "n":int(len(z)),"materialN":int(len(m)),"threshold":round(t,4),
              "directionalN":int(len(directional)),
              "directionalAccuracy":None if accuracy is None else round(accuracy,4),
              "meanNextFantasyDeltaAfterShareGain":None if len(up)==0 else round(float(up.actual_delta.mean()),3),
              "meanNextFantasyDeltaAfterShareLoss":None if len(down)==0 else round(float(down.actual_delta.mean()),3),
              "shareGainN":int(len(up)),"shareLossN":int(len(down))
            }
        result["splits"][split]=block
    return result

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--players",required=True); ap.add_argument("--out",required=True); a=ap.parse_args()
    r=build(pd.read_csv(a.players,low_memory=False))
    Path(a.out).write_text(json.dumps(r,indent=2)+"\n")
    print(json.dumps(r,indent=2))

if __name__=="__main__":main()
