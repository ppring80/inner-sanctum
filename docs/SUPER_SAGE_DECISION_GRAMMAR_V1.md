# SUPER SAGE OPERATOR — DECISION GRAMMAR V1

Status: SHADOW ONLY. This artifact cannot change a production recommendation.

## Product objective
Resolve a fantasy manager's uncertainty rather than merely provide more information. The Operator must make the competing cases explicit, make a call when the decision authority supplies one, state uncertainty, explain why the losing case did not win, and identify what new evidence would reopen the decision.

## Universal reasoning spine
1. Establish the prior.
2. Detect material change on either side of the matchup.
3. Test whether the prior remains valid.
4. Build the incumbent case.
5. Build the challenger case.
6. Evaluate evidence freshness, verification, representativeness, independence and conflicts.
7. Avoid double-counting facts that share one causal story.
8. Record belief movement without inventing numeric weights.
9. Determine whether the challenger crossed the decision threshold.
10. Make the call and state confidence.
11. Explain the losing argument and why it did not cross the threshold.
12. State what would flip/reopen the decision.
13. After games, Turbine #6 evaluates process separately from outcome.

## Evidence effects
- REINFORCES_PRIOR
- CHALLENGES_PRIOR
- REASSESS_PRIOR
- INVALIDATES_PRIOR
- CONTEXT_ONLY
- CONFLICTED_UNKNOWN

## Material-change scopes
### PLAYER
Availability, injury, limitation, return, suspension, role/usage change.

### OFFENSE
Teammate injury/return, QB change, offensive-line change, depth-chart movement, trade, coaching/play-caller change, personnel/scheme change, workload redistribution.

### OPPONENT_DEFENSE
Defender injury/return/suspension, trade, secondary/LB/DL personnel change, pass-rush change, run-front change, coverage/scheme change, coordinator/play-caller change.

### GAME_ENVIRONMENT
Weather, expected script/pace/scoring environment, kickoff optionality, and competitive state. Competitive urgency is context until there is a defensible path to coaching behavior and player opportunity.

## Evidence discipline
Historical reputation establishes a prior; fresh structural evidence may weaken, force reassessment of, or invalidate it.
Recent fantasy points alone do not prove structural change.
Opportunity/role change is more actionable than unexplained efficiency variance.
Correlated evidence sharing one causal group is counted once.
Missing or conflicting evidence reduces confidence before it creates a conclusion.
No outcome may enter a pregame trace.

## Decision trace contract
PRIOR -> MATERIAL CHANGES -> INCUMBENT CASE -> CHALLENGER CASE -> EVIDENCE DISCIPLINE -> BELIEF MOVEMENT -> THRESHOLD -> DECISION -> CONFIDENCE -> LOSING CASE -> FLIP CONDITIONS

## Canonical labs
1. Mahomes vs Maye — established baseline vs accumulating independent challenger evidence.
2. Tucker vs Miller — teammate absence, role redistribution and cross-position FLEX uncertainty.
3. Saquon Barkley — sound pregame decision followed by unknowable in-game injury; outcome cannot rewrite the pregame process.

## Promotion rule
V1 is observation and explanation only. It cannot alter Weekly SAGE, lineup authority, rankings, projections or policy. Any proposed decision-rule change must become a learning hypothesis, survive historical validation, regression testing and code review before production promotion.
