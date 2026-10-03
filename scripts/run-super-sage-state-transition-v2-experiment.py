#!/usr/bin/env python3
from __future__ import annotations
import argparse,json
from pathlib import Path
import numpy as np
import pandas as pd
SPLITS={"discovery":[2019,2020,2021,2022],"validation":[2023],"holdout":[2024,2025],"prospective":[2026]}
POSITIONS=("RB","WR","TE")

def build(df):
    d=df[df.position.isin(POSITIONS)].copy()
    for c in ("season","week","fantasy_half_ppr","carries","targets"): d[c]=pd.to_numeric(d[c],errors="coerce")
    tc="recent_team" if "recent_team" in d.columns else "team"
    if tc not in d.columns: raise KeyError("missing team identity")
    d["team_key"]=d[tc]
    d["opp"]=np.where(d.position.eq("RB"),d.carries.fillna(0),d.targets.fillna(0))
    team=d.groupby(["season","week","team_key","position"],dropna=False)["opp"].transform("sum")
    d["share"]=np.where(team.gt(0),d.opp/team,np.nan)
    d=d.sort_values(["season","player_id","week"]); g=d.groupby(["season","player_id"],sort=False)
    d["fantasy_prev3"]=g.fantasy_half_ppr.transform(lambda s:s.shift(1).rolling(3,min_periods=3).mean())
    d["opp_prev3"]=g.opp.transform(lambda s:s.shift(1).rolling(3,min_periods=3).mean())
    d["share_t1"]=g.share.shift(1); d["share_t2"]=g.share.shift(2)
    d["share_baseline"]=g.share.transform(lambda s:s.shift(3).rolling(3,min_periods=3).mean())
    d["delta_t1"]=d.share_t1-d.share_baseline; d["delta_t2"]=d.share_t2-d.share_baseline
    d["actual_delta"]=d.fantasy_half_ppr-d.fantasy_prev3
    d["actual_direction"]=np.select([d.actual_delta>=2,d.actual_delta<=-2],[1,-1],default=0)
    d=d.dropna(subset=["fantasy_prev3","opp_prev3","delta_t1","delta_t2","actual_delta"])
    disc=d[d.season.isin(SPLITS["discovery"])]
    thresholds={p:float(disc.loc[disc.position.eq(p),"delta_t1"].abs().quantile(.80)) for p in POSITIONS}
    result={"experiment":"turbine-5-state-transition-v2-persistence","v1Disposition":"REJECTED","frozenHypothesis":"A material opportunity-share transition that persists in the same direction for two consecutive observed games contains next-game directional information beyond recent fantasy production and raw opportunity.","mechanism":"Observed role persistence only; cause is not inferred.","noLookAhead":True,"thresholds":thresholds,"productionBoundary":"Experiment only; no production ranking change is authorized.","splits":{}}
    for split,seasons in SPLITS.items():
        x=d[d.season.isin(seasons)]; block={"n":int(len(x)),"positions":{}}
        for p in POSITIONS:
            z=x[x.position.eq(p)].copy(); t=thresholds[p]
            z["up"]=(z.delta_t1>=t)&(z.delta_t2>=t); z["down"]=(z.delta_t1<=-t)&(z.delta_t2<=-t); z["persistent"]=z.up|z.down
            z["pred"]=np.select([z.up,z.down],[1,-1],default=0); m=z[z.persistent]; directional=m[m.actual_direction.ne(0)]
            acc=None if len(directional)==0 else float((directional.pred==directional.actual_direction).mean())
            up=m[m.up]; down=m[m.down]
            block["positions"][p]={"n":int(len(z)),"persistentN":int(len(m)),"threshold":round(t,4),"directionalN":int(len(directional)),"directionalAccuracy":None if acc is None else round(acc,4),"meanNextFantasyDeltaAfterPersistentGain":None if len(up)==0 else round(float(up.actual_delta.mean()),3),"meanNextFantasyDeltaAfterPersistentLoss":None if len(down)==0 else round(float(down.actual_delta.mean()),3),"persistentGainN":int(len(up)),"persistentLossN":int(len(down))}
        result["splits"][split]=block
    return result

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--players",required=True); ap.add_argument("--out",required=True); a=ap.parse_args()
    r=build(pd.read_csv(a.players,low_memory=False)); Path(a.out).write_text(json.dumps(r,indent=2)+"\n"); print(json.dumps(r,indent=2))
if __name__=="__main__": main()
