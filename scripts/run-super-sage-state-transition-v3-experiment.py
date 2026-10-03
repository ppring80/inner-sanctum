#!/usr/bin/env python3
"""Super SAGE Turbine #5 V3: causal availability transition experiment.

Frozen before evaluation.
Treatment: an RB/WR/TE has a same-team RB/WR/TE teammate officially OUT in week t-1,
and the player's opportunity share rises versus its prior 3-game baseline.
Negative control: same OUT exposure without a share rise.
Outcome: week-t Half-PPR direction versus prior-3 fantasy average.
No future injury status is backfilled; only cause rows from t-1 are used.
"""
from __future__ import annotations
import argparse,json
from pathlib import Path
import numpy as np,pandas as pd
SPLITS={"discovery":[2019,2020,2021,2022],"validation":[2023],"holdout":[2024,2025]}
POS=("RB","WR","TE")

def key(s): return s.astype(str).str.lower().str.replace(r"[^a-z0-9]","",regex=True)

def build(players,causes):
 d=players[players.position.isin(POS)].copy()
 for c in ("season","week","fantasy_half_ppr","carries","targets"): d[c]=pd.to_numeric(d[c],errors="coerce")
 tc="recent_team" if "recent_team" in d.columns else "team"; d["team_key"]=d[tc]
 d["opp"]=np.where(d.position.eq("RB"),d.carries.fillna(0),d.targets.fillna(0))
 team=d.groupby(["season","week","team_key","position"])["opp"].transform("sum")
 d["share"]=np.where(team.gt(0),d.opp/team,np.nan)
 d=d.sort_values(["season","player_id","week"]); g=d.groupby(["season","player_id"],sort=False)
 d["fantasy_prev3"]=g.fantasy_half_ppr.transform(lambda s:s.shift(1).rolling(3,min_periods=3).mean())
 d["share_t1"]=g.share.shift(1); d["share_prior3"]=g.share.transform(lambda s:s.shift(2).rolling(3,min_periods=3).mean())
 d["share_delta_t1"]=d.share_t1-d.share_prior3
 d["actual_delta"]=d.fantasy_half_ppr-d.fantasy_prev3
 d["actual_direction"]=np.select([d.actual_delta>=2,d.actual_delta<=-2],[1,-1],default=0)
 d["player_key"]=key(d.player_name if "player_name" in d else d.player_display_name)

 c=causes.copy(); c["week"]=pd.to_numeric(c.week,errors="coerce"); c["season"]=pd.to_numeric(c.season,errors="coerce")
 c=c[c.report_status.astype(str).str.lower().eq("out") & c.position.astype(str).isin(POS)].copy()
 c["player_key"]=key(c.player_name); c["cause_week"]=c.week+1
 # A row for prediction week t is exposed only to teammate OUT status recorded in t-1.
 exposed=c[["season","cause_week","team","player_key"]].rename(columns={"team":"team_key","player_key":"out_player_key"})
 x=d.merge(exposed,left_on=["season","week","team_key"],right_on=["season","cause_week","team_key"],how="left")
 x=x[x.out_player_key.notna() & x.player_key.ne(x.out_player_key)].copy()
 # Collapse multiple OUT teammates to one player-week while preserving exposure count.
 x=x.groupby(["season","week","player_id"],as_index=False).agg(position=("position","first"),fantasy_prev3=("fantasy_prev3","first"),actual_delta=("actual_delta","first"),actual_direction=("actual_direction","first"),share_delta_t1=("share_delta_t1","first"),outTeammates=("out_player_key","nunique"))
 x=x.dropna(subset=["fantasy_prev3","share_delta_t1","actual_delta"])
 disc=x[x.season.isin(SPLITS["discovery"])]
 thresholds={p:float(disc.loc[disc.position.eq(p),"share_delta_t1"].clip(lower=0).quantile(.75)) for p in POS}
 out={"experiment":"turbine-5-v3-causal-availability","frozenQuestion":"Given a verified teammate OUT event known in the prior week, does measured opportunity redistribution improve next-game directional information beyond recent fantasy production?","cause":"same-team skill-position teammate officially OUT in t-1","noLookAhead":True,"v1Disposition":"REJECTED","v2Disposition":"REJECTED","thresholdRule":"Discovery-only 75th percentile positive share redistribution by position among exposed players.","thresholds":thresholds,"productionBoundary":"Experiment only; no production ranking change authorized.","splits":{}}
 for split,seasons in SPLITS.items():
  z=x[x.season.isin(seasons)]; block={"n":int(len(z)),"positions":{}}
  for p in POS:
   q=z[z.position.eq(p)].copy(); t=thresholds[p]; q["redistributed"]=q.share_delta_t1>=t
   treat=q[q.redistributed]; neg=q[~q.redistributed]; td=treat[treat.actual_direction.ne(0)]
   acc=None if len(td)==0 else float((td.actual_direction==1).mean())
   block["positions"][p]={"exposedN":int(len(q)),"treatmentN":int(len(treat)),"negativeControlN":int(len(neg)),"threshold":round(t,4),"directionalTreatmentN":int(len(td)),"upRateAmongDirectionalTreatment":None if acc is None else round(acc,4),"meanNextFantasyDeltaTreatment":None if len(treat)==0 else round(float(treat.actual_delta.mean()),3),"meanNextFantasyDeltaNegativeControl":None if len(neg)==0 else round(float(neg.actual_delta.mean()),3),"treatmentMinusNegativeControl":None if len(treat)==0 or len(neg)==0 else round(float(treat.actual_delta.mean()-neg.actual_delta.mean()),3)}
  out["splits"][split]=block
 return out

def main():
 ap=argparse.ArgumentParser(); ap.add_argument("--players",required=True); ap.add_argument("--causes",required=True); ap.add_argument("--out",required=True); a=ap.parse_args()
 r=build(pd.read_csv(a.players,low_memory=False),pd.read_csv(a.causes,low_memory=False)); Path(a.out).write_text(json.dumps(r,indent=2)+"\n"); print(json.dumps(r,indent=2))
if __name__=="__main__":main()
