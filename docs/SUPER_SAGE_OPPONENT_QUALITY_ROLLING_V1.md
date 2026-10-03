# Rolling Opponent Quality V1

Derives opponent-strength context from the completed-game evidence Inner Sanctum already owns.

For each defensive game, the opponent offensive baseline is computed only from that opponent's games BEFORE the game being evaluated. Week 1 therefore has no baseline. Missing baselines stay missing.

Initial context metrics: prior pass YPA and prior rush YPC. This is deliberately narrower than a full opponent-adjusted EPA model because the current cached box-score evidence does not contain EPA.

No future leakage. No additional Tank01 calls. Context only; no ranking changes.
