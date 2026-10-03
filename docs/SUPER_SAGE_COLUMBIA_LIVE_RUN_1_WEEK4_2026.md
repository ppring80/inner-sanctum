# Columbia Live Run #1 — Week 4, 2026

Scoring: Half-PPR
Run date: 2026-10-02

## Real production Weekly SAGE anchors

| Case | Production verdict | Rank | Confidence | Matchup |
|---|---|---:|---|---|
| Patrick Mahomes | START | QB7 | High | Negative vs LV |
| Chase Brown | START | RB10 | Moderate | Negative vs JAX |
| Courtland Sutton | SIT | WR49 | Moderate | Negative vs SF |
| Tyler Warren | START | TE3 | Moderate | Strong Positive vs WSH |
| Blake Corum | FLEX | RB27 | Limited | Positive vs PHI |

FLEX test: Blake Corum over Courtland Sutton. Production comparison basis: Positive matchup for Corum vs Negative for Sutton.

## Important live finding

The published compare_players MCP response already returns the Super SAGE progressive-disclosure contract:
- format: 1/3/10
- summaryFirst: true
- askForMoreDetail: true
- follow-up: "Would you like the deeper SAGE analysis on Blake Corum vs. Courtland Sutton?"
- no: stop
- yes: continue only with verified returned evidence
- never invent missing advanced metrics

## Tributary readiness from current live MCP output

Wet:
- Weekly SAGE rank/recommendation
- Weekly matchup label
- Weekly SAGE insight
- confidence
- known current role-change note where Weekly SAGE has it (example: Kendre Miller / Travis Etienne IR)

Dry/not yet surfaced through MCP:
- populated 32-team Scheme Matrix values
- populated Defensive Performance Matrix values
- QB Stress Matrix values
- player target/carry/route/air-yard advanced packet
- Game Environment values
- opponent-quality adjusted values
- metric-level sample/timeframe/source for advanced analysis

## Conclusion

Customer-delivery contract is live. Ranking authority is live. The next bottleneck is not UI architecture; it is populating and exposing verified advanced tributary data through the Columbia packet/MCP response.

No production ranking changes are authorized by this run.
