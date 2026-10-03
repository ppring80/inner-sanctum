#!/usr/bin/env python3
"""Turbine 5 V3 robustness audit: year stability, clustered uncertainty, concentration."""
import argparse,json
from pathlib import Path
import numpy as np,pandas as pd
POS=("RB","WR","TE")
def key(s):return s.astype(str).str.lower().str.replace(r"[^a-z0-9]","",regex=True)
def prep(players,causes):
 d=players[players.position.isin(POS)].copy()
 for c in ("season","week","fantasy_half_ppr","carries","targets"):d[c]=pd.to_numeric(d[c],errors="coerce")
 tc="recent_team" if "recent_team" in d.columns else "team";d["team_key"]=d[tc];d["opp"]=np.where(d.position.eq("RB"),d.carries.fillna(0),d.targets.fillna(0))
 total=d.groupby(["season","week","team_key","position"])["opp"].transform("sum");d["share"]=np.where(total.gt(0),d.opp/total,np.nan)
 d=d.sort_values(["season","player_id","week"]);g=d.groupby(["season","player_id"],sort=False)
 d["fantasy_prev3"]=g.fantasy_half_ppr.transform(lambda x:x.shift(1).rolling(3,min_periods=3).mean());d["share_t1"]=g.share.shift(1);d["share_prior3"]=g.share.transform(lambda x:x.shift(2).rolling(3,min_periods=3).mean());d["share_delta"]=d.share_t1-d.share_prior3;d["actual_delta"]=d.fantasy_half_ppr-d.fantasy_prev3
 d["player_key"]=key(d.player_name if "player_name" in d else d.player_display_name)
 c=causes[(causes.report_status.astype(str).str.lower()=="out")&causes.position.astype(str).isin(POS)].copy();c["season"]=pd.to_numeric(c.season);c["cause_week"]=pd.to_numeric(c.week)+1;c["out_key"]=key(c.player_name)
 x=d.merge(c[["season","cause_week","team","out_key"]].rename(columns={"team":"team_key"}),left_on=["season","week","team_key"],right_on=["season","cause_week","team_key"],how="left")
 x=x[x.out_key.notna()&x.player_key.ne(x.out_key)].groupby(["season","week","player_id"],as_index=False).agg(position=("position","first"),team_key=("team_key","first"),share_delta=("share_delta","first"),actual_delta=("actual_delta","first"))
 return x.dropna()
def main():
 ap=argparse.ArgumentParser();ap.add_argument("--players",required=True);ap.add_argument("--causes",required=True);ap.add_argument("--out",required=True);a=ap.parse_args()
 x=prep(pd.read_csv(a.players,low_memory=False),pd.read_csv(a.causes,low_memory=False));disc=x[x.season<=2022];thr={p:float(disc.loc[disc.position.eq(p),"share_delta"].clip(lower=0).quantile(.75)) for p in POS}
 rng=np.random.default_rng(20261003);res={"experiment":"turbine-5-v3-robustness-audit","thresholds":thr,"bootstrap":"player-cluster bootstrap, fixed seed, 2000 reps","positions":{}}
 for p in POS:
  z=x[(x.position==p)&x.season.isin([2024,2025])].copy();z["treat"]=z.share_delta>=thr[p]
  t=z[z.treat];n=z[~z.treat];obs=float(t.actual_delta.mean()-n.actual_delta.mean())
  ids=z.player_id.unique();boots=[]
  for _ in range(2000):
   sampled=rng.choice(ids,len(ids),replace=True);parts=[z[z.player_id==i] for i in sampled];b=pd.concat(parts,ignore_index=True);bt=b[b.treat];bn=b[~b.treat]
   if len(bt) and len(bn):boots.append(float(bt.actual_delta.mean()-bn.actual_delta.mean()))
  lo,hi=np.quantile(boots,[.025,.975])
  years={}
  for y in (2024,2025):
   q=z[z.season==y];qt=q[q.treat];qn=q[~q.treat];years[str(y)]={"treatmentN":len(qt),"negativeN":len(qn),"difference":None if not len(qt) or not len(qn) else round(float(qt.actual_delta.mean()-qn.actual_delta.mean()),3)}
  concentration=float(t.groupby("player_id").size().nlargest(10).sum()/len(t)) if len(t) else None
  res["positions"][p]={"holdoutTreatmentN":len(t),"holdoutNegativeN":len(n),"difference":round(obs,3),"clusterBootstrap95":[round(float(lo),3),round(float(hi),3)],"positiveBootstrapRate":round(float(np.mean(np.array(boots)>0)),4),"top10PlayerShareOfTreatment":round(concentration,4) if concentration is not None else None,"byYear":years}
 Path(a.out).write_text(json.dumps(res,indent=2)+"\n");print(json.dumps(res,indent=2))
if __name__=="__main__":main()
