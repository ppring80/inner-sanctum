# Super SAGE Columbia Material Change Detection V1

Purpose: make Super SAGE event-driven without constantly rebuilding every player.

Initial material triggers:
- any verified availability/status change
- material role/usage movement
- material defensive scheme/stress movement
- meaningful Weekly SAGE rank movement
- meaningful spread/implied-point movement

Default thresholds are conservative and configurable.

A material change triggers re-analysis only for affected players/matchups where possible. A refresh that produces no material evidence change does nothing.

This is the bridge between current-evidence refresh and responsive Super SAGE intelligence while protecting API usage.
