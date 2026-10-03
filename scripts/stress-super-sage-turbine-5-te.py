#!/usr/bin/env python3
"""Final Turbine 5 TE structural stress test. No threshold tuning."""
import argparse,json
from pathlib import Path
import numpy as np,pandas as pd
def key(s):return s.astype(str).str.lower().str.replace(r"[^a-z0-9]","",regex=True)
def prep(p,c):
 d=p[p.position.eq("TE")].copy()
 for x in ("season","week","fantasy_half_ppr","targets"):d[x]=pd.to_numeric(d[x],errors="coerce")
 tc="recent_team" if "recent_team" in d.columns else "team";d["team_key"]=d[tc];d["opp"]=d.targets.fillna(0)
 total=d.groupby(["season","week","team_key","position"])["opp"].transform("sum");d["share"]=np.where(total.gt(0),d.opp/total,np.nan)
 d=d.sort_values(["season","player_id","week"]);g=d.groupby(["season","player_id"],sort=False)
 d["f3"]=g.fantasy_half_ppr.transform(lambda x:x.shift(1).rolling(3,min_periods=3).mean());d["s1"]=g.share.shift(1);d["sb"]=g.share.transform(lambda x:x.shift(2).rolling(3,min_periods=3).mean());d["delta"]=d.s1-d.sb;d["outcome"]=d.fantasy_half_ppr-d.f3;d["pk"]=key(d.player_name if "player_name" in d else d.player_display_name)
 c=c[(c.report_status.astype(str).str.lower()=="out")&c.position.astype(str).isin(["RB","WR","TE"])].copy();c["season"]=pd.to_numeric(c.season);c["cw"]=pd.to_numeric(c.week)+1;c["ok"]=key(c.player_name)
 x=d.merge(c[["season","cw","team","ok"]].rename(columns={"team":"team_key"}),left_on=["season","week","team_key"],right_on=["season","cw","team_key"],how="left")
 x=x[x.ok.notna()&x.pk.ne(x.ok)].groupby(["season","week","player_id"],as_index=False).agg(delta=("delta","first"),outcome=("outcome","first"))
 return x.dropna()
def effect(z,t):
 a=z[z.delta>=t].outcome;b=z[z.delta<t].outcome
 return None if not len(a) or not len(b) else float(a.mean()-b.mean())
def main():
 ap=argparse.ArgumentParser();ap.add_argument("--players",required=True);ap.add_argument("--causes",required=True);ap.add_argument("--out",required=True);a=ap.parse_args()
 x=prep(pd.read_csv(a.players,low_memory=False),pd.read_csv(a.causes,low_memory=False));disc=x[x.season<=2022];base=float(disc.delta.clip(lower=0).quantile(.75))
 # Stress neighboring PRE-SPECIFIED quantiles; they are diagnostics, not alternate selection rules.
 qs={str(q):float(disc.delta.clip(lower=0).quantile(q)) for q in (.70,.75,.80)}
 years={str(y):{"n":int(len(x[x.season==y])),"effect":round(effect(x[x.season==y],base),3) if effect(x[x.season==y],base) is not None else None} for y in range(2019,2026)}
 hold=x[x.season.isin([2024,2025])]
 sensitivity={q:{"threshold":round(t,4),"holdoutEffect":round(effect(hold,t),3)} for q,t in qs.items()}
 # Leave-one-season-out over all seven seasons, always using frozen 75th percentile threshold.
 loso={}
 for y in range(2019,2026):
  z=x[x.season!=y];loso[str(y)]=round(effect(z,base),3)
 res={"experiment":"turbine-5-final-te-structural-stress","position":"TE","frozenThreshold":base,"thresholdSource":"2019-22 discovery 75th percentile; unchanged from V3","noLookAhead":True,"bySeason":years,"leaveOneSeasonOut":loso,"thresholdSensitivityDiagnostic":sensitivity,"commissionRule":"Evidence is structurally robust only if 2024 and 2025 are both positive, every leave-one-season-out effect is positive, and 70/75/80 percentile diagnostic holdout effects remain positive."}
 Path(a.out).write_text(json.dumps(res,indent=2)+"\n");print(json.dumps(res,indent=2))
if __name__=="__main__":main()
