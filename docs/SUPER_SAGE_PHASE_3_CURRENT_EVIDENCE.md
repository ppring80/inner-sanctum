# Super SAGE Phase 3 — Current Evidence

This layer gives Super SAGE a disciplined way to consume current NFL evidence.

## Evidence types
TEAM_TENDENCY, PLAYER_ROLE, INJURY_STATUS, USAGE, SCHEME, MATCHUP, COACHING_CHANGE, LINEUP_CONTEXT.

## Required fields
Every evidence item requires:
- source tier
- named source
- exact claim
- observed timestamp

Optional fields preserve season/week, team/player, metric/value/unit and sample metadata.

## Freshness
Fast-moving injury, role, usage and lineup evidence uses a short freshness window. Structural/tendency evidence can live longer but still expires.

## Boundary
Current evidence can clear the Skeptic for a current analysis. It cannot change Weekly SAGE ranking weights by itself.
