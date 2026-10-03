#!/usr/bin/env python3
from __future__ import annotations
import argparse,json
from pathlib import Path
import pandas as pd
from scipy.stats import spearmanr

POS={"QB","RB","WR","TE"}
SPLITS={"discovery":[2019,2020,2021,2022],"validation":[2023],"holdout":[2024,2025],"prospective":[2026]}

def rho(d,col):
    z=d[[col,"fantasy_half_ppr"]].dropna()
    return None if len(z)<10 else round(float(spearmanr(z[col],z["fantasy_half_ppr"]).statistic),4)

def _gt(a,b):
    return a is not None and b is not None and a>b

def _directional_gate(result, positions, left_key, right_key):
    """Require the frozen claim to hold in validation AND untouched holdout."""
    evidence={}
    for split in ("validation","holdout"):
        checks={}
        for pos in positions:
            p=result["splits"][split]["positions"][pos]
            left=p[left_key(pos) if callable(left_key) else left_key]
            right=p[right_key(pos) if callable(right_key) else right_key]
            checks[pos]={"left":left,"right":right,"passes":_gt(left,right)}
        evidence[split]=checks

    validation_pass=all(x["passes"] for x in evidence["validation"].values())
    holdout_pass=all(x["passes"] for x in evidence["holdout"].values())
    if validation_pass and holdout_pass:
        status="VALIDATION_AND_HOLDOUT_PASS"
    elif not holdout_pass:
        status="HOLDOUT_FAIL"
    else:
        status="VALIDATION_FAIL"
    return status,evidence

def build(df):
    d=df[df.position.isin(POS)].sort_values(["season","player_id","week"]).copy()
    for c in ["fantasy_half_ppr","targets","carries","attempts"]:
        d[c]=pd.to_numeric(d[c],errors="coerce").fillna(0)
        g=d.groupby(["season","player_id"],sort=False)[c]
        d[c+"_prev1"]=g.shift(1)
        d[c+"_avg3"]=g.transform(lambda s:s.shift(1).rolling(3,min_periods=1).mean())
    d=d[d.fantasy_half_ppr_prev1.notna()].copy()
    result={
      "battery":"learning-battery-1",
      "outcome":"next-week Half-PPR",
      "noLookAhead":True,
      "verdictPolicy":{
        "frozenBeforeEvaluation":True,
        "rule":"A directional hypothesis passes only when its stated comparison holds for every named position in both 2023 validation and untouched 2024-25 holdout.",
        "statuses":["VALIDATION_AND_HOLDOUT_PASS","VALIDATION_FAIL","HOLDOUT_FAIL"],
        "productionBoundary":"A passing learning hypothesis is evidence only; it does not authorize a Weekly SAGE production change."
      },
      "splits":{}
    }
    for split,seasons in SPLITS.items():
        x=d[d.season.isin(seasons)]
        block={"n":int(len(x)),"positions":{}}
        for pos in ["QB","RB","WR","TE"]:
            p=x[x.position.eq(pos)]
            usage="attempts_avg3" if pos=="QB" else "carries_avg3" if pos=="RB" else "targets_avg3"
            block["positions"][pos]={
              "n":int(len(p)),
              "priorWeekFantasyRho":rho(p,"fantasy_half_ppr_prev1"),
              "threeGameFantasyRho":rho(p,"fantasy_half_ppr_avg3"),
              "threeGameOpportunityMetric":usage,
              "threeGameOpportunityRho":rho(p,usage)
            }
        result["splits"][split]=block

    h1_status,h1_evidence=_directional_gate(
        result,["QB","RB","WR","TE"],"threeGameFantasyRho","priorWeekFantasyRho"
    )
    h2_status,h2_evidence=_directional_gate(
        result,["RB","WR","TE"],"threeGameOpportunityRho","priorWeekFantasyRho"
    )
    h3_status,h3_evidence=_directional_gate(
        result,["QB"],"threeGameOpportunityRho","threeGameFantasyRho"
    )
    result["hypotheses"]=[
      {
        "id":"LB1-H1",
        "claim":"Three-game recent fantasy production is more predictive of next-week Half-PPR than the immediately prior game.",
        "status":h1_status,
        "acceptanceRule":"threeGameFantasyRho > priorWeekFantasyRho for QB/RB/WR/TE in validation and holdout",
        "evidence":h1_evidence
      },
      {
        "id":"LB1-H2",
        "claim":"For RB/WR/TE, recent opportunity (carries or targets) contains stronger next-week ranking signal than immediately prior-week fantasy output.",
        "status":h2_status,
        "acceptanceRule":"threeGameOpportunityRho > priorWeekFantasyRho for RB/WR/TE in validation and holdout",
        "evidence":h2_evidence
      },
      {
        "id":"LB1-H3",
        "claim":"QB pass-attempt volume alone is a stronger next-week signal than recent QB fantasy production.",
        "status":h3_status,
        "acceptanceRule":"threeGameOpportunityRho > threeGameFantasyRho for QB in validation and holdout",
        "evidence":h3_evidence
      }
    ]
    return result

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--input",required=True)
    ap.add_argument("--out",required=True)
    a=ap.parse_args()
    r=build(pd.read_csv(a.input,low_memory=False))
    Path(a.out).write_text(json.dumps(r,indent=2)+"\n")
    print(json.dumps(r,indent=2))

if __name__=="__main__":
    main()
