#!/usr/bin/env python3
"""Super SAGE Turbine #4: historical game-environment experiment.

Pregame market context comes from nflverse/nfldata games.csv. The experiment
uses spread_line and total_line only; final scores/results are never predictors.
Player outcomes come from the existing Historical Lab V1 player-weeks corpus.

Frozen question:
Does pregame game environment add next-week Half-PPR ranking signal beyond
recent player fantasy production and opportunity?

This script builds team-perspective implied points from the published closing
spread/total, joins them to player-week outcomes, and reports chronological
discovery/validation/holdout/prospective evidence. It does not authorize any
production ranking change.
"""
from __future__ import annotations
import argparse,json
from pathlib import Path
import numpy as np
import pandas as pd
from scipy.stats import spearmanr

GAMES_URL="https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
SPLITS={"discovery":[2019,2020,2021,2022],"validation":[2023],"holdout":[2024,2025],"prospective":[2026]}
POSITIONS=("QB","RB","WR","TE")

def rho(d,col):
    z=d[[col,"fantasy_half_ppr"]].dropna()
    return None if len(z)<10 else round(float(spearmanr(z[col],z["fantasy_half_ppr"]).statistic),4)

def incremental_r2(d, base_cols, extra_cols):
    cols=list(dict.fromkeys(base_cols+extra_cols+["fantasy_half_ppr"]))
    z=d[cols].replace([np.inf,-np.inf],np.nan).dropna()
    if len(z)<50:return None
    y=z["fantasy_half_ppr"].to_numpy(float)
    def fit(cols_):
        X=z[cols_].to_numpy(float)
        X=np.column_stack([np.ones(len(X)),X])
        beta=np.linalg.lstsq(X,y,rcond=None)[0]
        pred=X@beta
        ss_res=float(np.sum((y-pred)**2)); ss_tot=float(np.sum((y-y.mean())**2))
        return 0.0 if ss_tot==0 else 1.0-ss_res/ss_tot
    return round(fit(base_cols+extra_cols)-fit(base_cols),6)

def team_environment(games):
    g=games.copy()
    for c in ("season","week","spread_line","total_line"):
        g[c]=pd.to_numeric(g[c],errors="coerce")
    if "game_type" in g.columns:g=g[g.game_type.astype(str).str.upper().eq("REG")]
    g=g[g.season.between(2019,2026)&g.total_line.notna()&g.spread_line.notna()].copy()

    # nflverse spread_line is from the home-team perspective: positive means
    # home favored. Team implied points = (total +/- spread)/2.
    home=pd.DataFrame({
      "season":g.season,"week":g.week,"team":g.home_team,
      "opponent":g.away_team,"game_id":g.game_id,
      "total_line":g.total_line,"team_spread":-g.spread_line,
      "team_implied":(g.total_line+g.spread_line)/2,
      "opp_implied":(g.total_line-g.spread_line)/2
    })
    away=pd.DataFrame({
      "season":g.season,"week":g.week,"team":g.away_team,
      "opponent":g.home_team,"game_id":g.game_id,
      "total_line":g.total_line,"team_spread":g.spread_line,
      "team_implied":(g.total_line-g.spread_line)/2,
      "opp_implied":(g.total_line+g.spread_line)/2
    })
    return pd.concat([home,away],ignore_index=True)

def build(players,games):
    d=players[players.position.isin(POSITIONS)].copy()
    d["season"]=pd.to_numeric(d.season,errors="coerce")
    d["week"]=pd.to_numeric(d.week,errors="coerce")
    for c in ("fantasy_half_ppr","targets","carries","attempts"):
        d[c]=pd.to_numeric(d[c],errors="coerce").fillna(0)
    # Historical Lab V1 can contain both recent_team and team. Renaming
    # recent_team to team would create duplicate column labels and make the
    # market-data merge ambiguous. Build one explicit join key instead.
    if "recent_team" in d.columns:
        d["market_team"]=d["recent_team"]
    elif "team" in d.columns:
        d["market_team"]=d["team"]
    else:
        raise KeyError("Historical player-weeks missing recent_team/team join key")
    d=d.sort_values(["season","player_id","week"])
    for c in ("fantasy_half_ppr","targets","carries","attempts"):
        grp=d.groupby(["season","player_id"],sort=False)[c]
        d[c+"_avg3"]=grp.transform(lambda s:s.shift(1).rolling(3,min_periods=1).mean())
    env=team_environment(games).rename(columns={"team":"market_team"})
    d=d.merge(env,on=["season","week","market_team"],how="left")
    d=d[d.fantasy_half_ppr_avg3.notna()].copy()

    result={
      "experiment":"turbine-4-game-environment-v1",
      "frozenQuestion":"Does pregame game environment add next-week Half-PPR ranking signal beyond recent player fantasy production and opportunity?",
      "source":"nflverse/nfldata games.csv spread_line + total_line",
      "noLookAhead":True,
      "forbiddenPredictors":["home_score","away_score","result","same-week player box-score outcomes"],
      "productionBoundary":"Experiment only. No Weekly SAGE ranking change is authorized.",
      "splits":{}
    }
    for split,seasons in SPLITS.items():
        x=d[d.season.isin(seasons)]
        block={"n":int(len(x)),"marketCoverage":round(float(x.team_implied.notna().mean()),4) if len(x) else None,"positions":{}}
        for pos in POSITIONS:
            p=x[x.position.eq(pos)]
            usage="attempts_avg3" if pos=="QB" else "carries_avg3" if pos=="RB" else "targets_avg3"
            block["positions"][pos]={
              "n":int(len(p)),
              "teamImpliedRho":rho(p,"team_implied"),
              "totalLineRho":rho(p,"total_line"),
              "spreadRho":rho(p,"team_spread"),
              "baselineFantasyRho":rho(p,"fantasy_half_ppr_avg3"),
              "opportunityRho":rho(p,usage),
              "incrementalR2TeamImplied":incremental_r2(p,["fantasy_half_ppr_avg3",usage],["team_implied"]),
              "incrementalR2FullEnvironment":incremental_r2(p,["fantasy_half_ppr_avg3",usage],["team_implied","total_line","team_spread"])
            }
        result["splits"][split]=block
    return result

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--players",required=True)
    ap.add_argument("--games-url",default=GAMES_URL)
    ap.add_argument("--out",required=True)
    a=ap.parse_args()
    players=pd.read_csv(a.players,low_memory=False)
    games=pd.read_csv(a.games_url,low_memory=False)
    r=build(players,games)
    Path(a.out).write_text(json.dumps(r,indent=2)+"\n")
    print(json.dumps(r,indent=2))

if __name__=="__main__":main()
