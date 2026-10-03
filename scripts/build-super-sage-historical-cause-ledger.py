#!/usr/bin/env python3
"""Build Super SAGE Historical Cause Ledger V1 from nflverse weekly injury reports.

Temporal rule: the ledger stores the week-level report state only. It never
backfills future status into an earlier week. V3 may use a row only as context
for that row's season/week or later, according to an explicitly frozen replay
rule.

Source data are nflverse injury-report releases, available since 2009.
"""
from __future__ import annotations
import argparse,json
from pathlib import Path
import pandas as pd

URL="https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_{season}.csv"
KEEP_STATUS={"out","doubtful","injured reserve","ir","pup"}

def first_col(df,names):
    for n in names:
        if n in df.columns:return n
    return None

def build(start,end):
    rows=[]; schema={}
    for season in range(start,end+1):
        d=pd.read_csv(URL.format(season=season),low_memory=False)
        schema[str(season)]=list(d.columns)
        week=first_col(d,["week"]); name=first_col(d,["full_name","player_name","name"])
        pid=first_col(d,["gsis_id","player_id"]); team=first_col(d,["team","team_abbr"])
        pos=first_col(d,["position","pos"]); status=first_col(d,["report_status","game_status","status"])
        if not week or not name or not status: raise RuntimeError(f"{season}: injury schema lacks week/name/status")
        x=pd.DataFrame({"season":season,"week":pd.to_numeric(d[week],errors="coerce"),"player_name":d[name],"player_id":d[pid] if pid else None,"team":d[team] if team else None,"position":d[pos] if pos else None,"report_status":d[status]})
        x["status_key"]=x.report_status.astype(str).str.strip().str.lower()
        x=x[x.status_key.isin(KEEP_STATUS)&x.week.notna()&x.player_name.notna()].copy()
        x["week"]=x.week.astype(int); x["source"]="nflverse injury reports"; x["source_season"]=season
        rows.append(x[["season","week","player_id","player_name","team","position","report_status","source","source_season"]])
    out=pd.concat(rows,ignore_index=True)
    out=out.drop_duplicates(["season","week","player_id","player_name","team","report_status"])
    meta={"version":1,"source":"nflverse injury reports","window":{"startSeason":start,"endSeason":end},"rows":int(len(out)),"seasons":sorted(int(x) for x in out.season.unique()),"temporalRule":"No future status backfill. Week-level report state is preserved exactly by season/week.","lookAheadAudit":"V3 must never use a cause row from a week later than the prediction decision week.","schemaBySeason":schema}
    return out,meta

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--start",type=int,default=2019); ap.add_argument("--end",type=int,default=2025); ap.add_argument("--out",required=True); a=ap.parse_args()
    outdir=Path(a.out); outdir.mkdir(parents=True,exist_ok=True); ledger,meta=build(a.start,a.end)
    ledger.to_csv(outdir/"cause-ledger.csv",index=False); (outdir/"cause-ledger-manifest.json").write_text(json.dumps(meta,indent=2)+"\n"); print(json.dumps(meta,indent=2))
if __name__=="__main__":main()
