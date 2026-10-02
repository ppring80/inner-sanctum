# Super SAGE Learning — Role Change Detection V1

Question: Does short-term opportunity acceleration add predictive value beyond a player's recent three-game opportunity average?

Method:
- Predictor data strictly shifted to prior games.
- 2019-22 discovery.
- 2023 validation.
- 2024-25 untouched holdout.
- RB opportunity = carries; WR/TE opportunity = targets.
- Acceleration = most recent prior-game opportunity minus mean of the two preceding games.

Holdout incremental R-squared after adding acceleration to recent-average opportunity:
- RB: +0.0009
- WR: +0.0008
- TE: +0.0030

Result: SIMPLE ACCELERATION REJECTED AS A STANDALONE ROLE-CHANGE SIGNAL.

Interpretation:
A rising sequence such as 3 -> 6 -> 9 targets is not, by itself, enough evidence to materially upgrade a next-week forecast beyond the recent workload level. SAGE should require corroborating structural evidence before calling a durable role change.

Required next role-change features:
- snap share / route participation
- starter/depth-chart change
- teammate injury/absence
- personnel/package change
- sustained opportunity after the triggering event
- coaching comments when source quality permits
- game-state/context controls

Production impact: NONE. This result prevents an unsupported trend-chasing rule from entering Weekly SAGE.
