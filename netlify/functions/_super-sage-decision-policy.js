"use strict";

// ═══════════════════════════════════════════════════════════════════════
// SUPER SAGE — FROZEN DECISION POLICY
// ═══════════════════════════════════════════════════════════════════════
//
// The only numeric policy the Super SAGE decision layer may use. Every value
// must come from a historical backtest and carry its provenance. Values are
// changed only by code review after a new calibration run — never at runtime,
// never from a single week, and never to produce a preferred lineup.
//
// Current status: UNCALIBRATED (Option B, 2026-10-03).
//   Calibration was attempted and could not run: historical pre-game Tank01
//   projections are not available to the calibration environment (Tank01 and
//   the production `weekly-projections` Blob store return 403
//   host_not_allowed; no projection snapshot has ever been committed).
//   nflverse actuals are reachable but have no pre-game projections; the
//   nflverse expected-points model is computed from actual plays (leakage)
//   and is not Tank01.
//
// While UNCALIBRATED:
//   * No ORDINARY cross-position comparison can be resolved by projection.
//     Every cross-position displacement keeps the forward-evidence burden.
//   * "Near-zero projection" means exactly zero (points <= 0), so INVALID
//     requires an OUT-leaning status corroborated by a fresh zero projection.
//
// Calibration method (to run once historical projections are exported):
//   pairs   = same-week, same-tier, different-position FLEX-eligible players,
//             both not ruled out pre-kickoff
//   outcome = higher-projected player outscores the other (nflverse actuals
//             re-scored to the format under test)
//   band    = smallest projection gap whose win-rate lower 95% Wilson bound
//             exceeds 0.5
//   segment by scoring format, position pair, projection source only if a
//   logistic gap x segment interaction is significant AND every segment has
//   >= 300 pairs; otherwise one global band.
// ═══════════════════════════════════════════════════════════════════════

const UNCALIBRATED = "UNCALIBRATED";
const CALIBRATED = "CALIBRATED";

const CALIBRATION_ATTEMPT = Object.freeze({
  attemptedAt: "2026-10-03",
  outcome: "NOT_RUN_DATA_UNAVAILABLE",
  reason: "Historical pre-game Tank01 projections unavailable to the calibration environment (Tank01 API and production weekly-projections Blob store: 403 host_not_allowed; none committed to the repository).",
  availableSources: ["nflverse stats_player_week (actuals)"],
  missingSources: ["historical pre-game Tank01 projections", "historical Weekly SAGE tier snapshots"]
});

const POLICY = Object.freeze({
  version: "2026-10-03-uncalibrated",
  projectionNoiseBand: Object.freeze({
    status: UNCALIBRATED,
    // When CALIBRATED: { global: number } or segmented values keyed by
    // `${scoring}|${positionPair}|${source}` with `global` as fallback.
    values: null,
    provenance: CALIBRATION_ATTEMPT
  }),
  nearZeroProjection: Object.freeze({
    status: UNCALIBRATED,
    // When CALIBRATED: fraction of the player's own position+tier median
    // fresh projection below which a projection signals non-participation.
    fractionOfTierMedian: null,
    uncalibratedRule: "EXACT_ZERO",
    provenance: CALIBRATION_ATTEMPT
  })
});

const positionPair = (a, b) => [String(a).toUpperCase(), String(b).toUpperCase()].sort().join("-");

/** Projection-noise band for one comparison. Never invents a value. */
function projectionBandFor(policy, { scoring, positions, source } = {}) {
  const band = policy && policy.projectionNoiseBand;
  if (!band || band.status !== CALIBRATED || !band.values) {
    return { calibrated: false, value: null, status: band ? band.status : UNCALIBRATED, segment: null };
  }
  const key = `${String(scoring || "").toLowerCase()}|${positionPair(positions[0], positions[1])}|${source || ""}`;
  if (Number.isFinite(band.values[key])) return { calibrated: true, value: band.values[key], status: CALIBRATED, segment: key };
  if (Number.isFinite(band.values.global)) return { calibrated: true, value: band.values.global, status: CALIBRATED, segment: "global" };
  return { calibrated: false, value: null, status: UNCALIBRATED, segment: null };
}

/** True when a fresh projection signals non-participation under the policy. */
function isNearZeroProjection(policy, points, tierMedian) {
  if (!Number.isFinite(points)) return false;
  const rule = policy && policy.nearZeroProjection;
  if (rule && rule.status === CALIBRATED && Number.isFinite(rule.fractionOfTierMedian) && Number.isFinite(tierMedian) && tierMedian > 0) {
    return points < rule.fractionOfTierMedian * tierMedian;
  }
  return points <= 0;
}

module.exports = { POLICY, UNCALIBRATED, CALIBRATED, CALIBRATION_ATTEMPT, projectionBandFor, isNearZeroProjection, positionPair };
