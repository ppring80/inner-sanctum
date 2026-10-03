"use strict";

// ═══════════════════════════════════════════════════════════════════════
// SUPER SAGE — VALIDATED SIGNAL REGISTRY
// ═══════════════════════════════════════════════════════════════════════
//
// The single place that says which FORWARD-LOOKING signals may move a lineup
// decision. Everything else Columbia gathers (observed workload, matchup,
// state changes without a validated magnitude) can be explained but can never
// decide a cross-position displacement on its own.
//
// Status values:
//   "promoted"   survived historical validation AND was approved for
//                production decisions. Only these are decision-active.
//   "candidate"  survived validation but has not been approved for decisions.
//                Explained, never decisive.
//   "observed"   a repeatable pattern that is not validated. Explained only.
//   "rejected"   failed validation. Explained only (and labelled as such).
//
// Promotion is a product decision recorded here in code review — never a
// runtime toggle and never tuned to a specific week or roster.
// ═══════════════════════════════════════════════════════════════════════

const SIGNALS = Object.freeze({
  "turbine5-v1-opportunity-share-magnitude": Object.freeze({
    status: "rejected",
    positions: ["RB", "WR", "TE"],
    summary: "Opportunity-share magnitude alone did not predict future production."
  }),
  "turbine5-v2-opportunity-persistence": Object.freeze({
    status: "rejected",
    positions: ["RB", "WR", "TE"],
    summary: "Persistence of recent opportunity alone did not predict future production."
  }),
  "turbine5-v3-causal-availability-transition-rb": Object.freeze({
    status: "rejected",
    positions: ["RB"],
    summary: "RB verified-cause redistribution signal did not survive robust validation."
  }),
  "turbine5-v3-causal-availability-transition-wr": Object.freeze({
    status: "observed",
    positions: ["WR"],
    summary: "Repeatable negative / mean-reversion-like WR result; not promoted."
  }),
  "turbine5-v3-causal-availability-transition-te": Object.freeze({
    status: "candidate",
    positions: ["TE"],
    summary: "Verified cause plus redistribution produced a robust forward-looking TE signal; awaiting promotion."
  })
});

function signalStatus(id, registry = SIGNALS) {
  const entry = registry[id];
  return entry ? entry.status : "unknown";
}

// A signal can move a decision only if it is promoted for that position and the
// evidence instance itself is verified.
function isDecisionActive(signal, position, registry = SIGNALS) {
  if (!signal || signal.verified !== true) return false;
  const entry = registry[signal.id];
  return Boolean(entry && entry.status === "promoted" && entry.positions.includes(position));
}

module.exports = { SIGNALS, signalStatus, isDecisionActive };
