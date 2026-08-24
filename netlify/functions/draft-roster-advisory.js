// netlify/functions/draft-roster-advisory.js
//
// WEEKLY SAGE — DRAFT COMMAND CENTER ROSTER STRATEGY ADVISORY (Phase 2)
//
// PURPOSE
// -------
// A separate, roster-LEVEL advisory layer, distinct from the per-player
// recommendation engine in sage-recommend.js. Answers three questions,
// once per still-open starting position:
//
//   1. Is this position still an unmet starting requirement?
//   2. Given real remaining draft-pool depth at that position, is
//      waiting comfortable, worth monitoring, or increasingly risky?
//   3. What's a plain-language explanation the customer can trust,
//      without SAGE claiming reasoning it did not actually perform?
//
// THIS MODULE NEVER:
// - ranks, reorders, or filters the player recommendations
// - changes any recommendation's code/explanation/reasons
// - boosts a position into being recommended
// - claims a head-to-head comparison between two specific players
// - claims certainty about a player's future availability
// - claims the roster context changed anything about the ranking
//
// It is pure, synchronous, side-effect-free, and has NO dependency on
// Netlify Blobs, Opportunity Intelligence, Context Intelligence, or any
// of the pillar files. It consumes only:
//   - rosterContext (draft.html's computeRosterNeed() output, same
//     object Phase 1 already reads)
//   - currentPool: the RAW, unenriched available-player list (same
//     shape as `candidates` -- {name, pos, adp, ...}), filtered only
//     for basic shape validity.
//
// WHY RAW currentPool, NOT THE OPPORTUNITY-ENRICHED VERSION
// -----------------------------------------------------------
// sage-recommend.js separately builds an Opportunity-enriched pool (via
// buildOpportunityPool) for Scarcity's per-candidate "comparable tier"
// calculations. That enriched pool SILENTLY DROPS any player whose name
// didn't resolve to an Opportunity Intelligence record -- correct for
// Scarcity's per-candidate question, but wrong for a simple "how many
// players remain at this position" headcount: it would systematically
// undercount real depth whenever Opportunity data has a coverage gap,
// risking a false PRIORITY_NOW verdict caused by missing data rather
// than a real thinning position. This module deliberately uses the
// complete raw pool instead.
//
// WHY THIS DOESN'T CALL buildDraftScarcityProfile (draft-scarcity-
// profile.js) DIRECTLY
// -----------------------------------------------------------
// That module's real per-candidate "comparable opportunity" question
// requires an Opportunity record for every pool member being compared
// against -- i.e. the same enrichment/coverage-gap tradeoff above, plus
// additional cache-lookup cost this first pass deliberately avoids to
// keep the regression surface small (same reasoning the codebase
// already uses elsewhere for phased rollouts). A depth-aware, tier-
// sensitive version that reuses draft-scarcity-profile.js's exported
// isComparable()/volumeRank() helpers against the already-computed
// enriched pool is a reasonable later refinement, not this pass.
//
// ═══════════════════════════════════════════════════════════════════════

// Same six-position order Phase 1 already established in
// sage-recommend.js's ROSTER_POSITION_ORDER. Deliberately duplicated
// here rather than shared/imported -- this module has zero dependency
// on sage-recommend.js today, and duplicating one small array keeps it
// that way, matching this codebase's established preference (see
// sage-pick-validation.js / sage-recommend.js precedent) for small,
// independently-testable duplication over cross-file coupling when the
// alternative is a new shared dependency for a handful of literals.
const ROSTER_POSITION_ORDER = [
  "QB",
  "RB",
  "WR",
  "TE",
  "K",
  "DEF"
];

const CORE_OFFENSIVE_POSITIONS = [
  "QB",
  "RB",
  "WR",
  "TE"
];

const KDEF_POSITIONS = [
  "K",
  "DEF"
];

// Depth thresholds, expressed as a multiple of league size rather than
// an absolute headcount, so a 10-team and a 14-team league are judged
// on comparable terms. Deliberately simple and documented as tunable --
// this is a first-pass heuristic, not a claimed-precise model.
const SAFE_DEPTH_MULTIPLIER =
  1.5;

const MONITOR_DEPTH_MULTIPLIER =
  0.75;

// Used only when rosterContext.numTeams is missing/invalid. A common
// default league size -- never allowed to block the advisory outright,
// since an approximate depth read is safer than none, and this module
// never touches recommendations regardless of how this default lands.
const DEFAULT_NUM_TEAMS =
  10;

const MAX_REPRESENTATIVE_OPTIONS =
  3;

const CLASSIFICATION_LABELS = {
  SAFE_TO_WAIT:
    "Options Still Available",

  MONITOR:
    "Keep Monitoring",

  PRIORITY_NOW:
    "Consider Addressing Soon"
};

function isPlainObject(
  value
) {
  return Boolean(
    value &&
    typeof value ===
      "object" &&
    !Array.isArray(
      value
    )
  );
}

function normalizePos(
  pos
) {
  return String(
    pos ||
    ""
  ).toUpperCase();
}

// Every unmet dedicated position, in canonical order. Unlike Phase 1's
// buildRosterContextNote() (which deliberately stops at the FIRST unmet
// position, since it only ever needed one), this returns ALL of them --
// the whole point of the roster-level advisory is not to go silent on
// positions 2+.
function findUnmetPositions(
  remainingDedicated
) {
  return ROSTER_POSITION_ORDER.filter(
    function (pos) {
      return (
        Number.isFinite(
          remainingDedicated[
            pos
          ]
        ) &&
        remainingDedicated[
          pos
        ] >
          0
      );
    }
  );
}

function countRemainingAtPosition(
  currentPool,
  pos
) {
  return (
    currentPool ||
    []
  ).filter(
    function (p) {
      return (
        p &&
        normalizePos(
          p.pos
        ) ===
          pos
      );
    }
  ).length;
}

function representativeNames(
  currentPool,
  pos
) {
  const atPos =
    (
      currentPool ||
      []
    ).filter(
      function (p) {
        return (
          p &&
          normalizePos(
            p.pos
          ) ===
            pos &&
          typeof p.name ===
            "string" &&
          p.name.trim().length >
            0
        );
      }
    );

  const sorted =
    atPos.slice().sort(
      function (a, b) {
        const aAdp =
          Number.isFinite(
            a.adp
          )
            ? a.adp
            : Infinity;

        const bAdp =
          Number.isFinite(
            b.adp
          )
            ? b.adp
            : Infinity;

        return (
          aAdp -
          bAdp
        );
      }
    );

  return sorted
    .slice(
      0,
      MAX_REPRESENTATIVE_OPTIONS
    )
    .map(
      function (p) {
        return p.name;
      }
    );
}

function classifyDepth(
  remainingAtPosition,
  numTeams
) {
  const safeThreshold =
    Math.ceil(
      numTeams *
      SAFE_DEPTH_MULTIPLIER
    );

  const monitorThreshold =
    Math.ceil(
      numTeams *
      MONITOR_DEPTH_MULTIPLIER
    );

  if (
    remainingAtPosition >=
    safeThreshold
  ) {
    return "SAFE_TO_WAIT";
  }

  if (
    remainingAtPosition >=
    monitorThreshold
  ) {
    return "MONITOR";
  }

  return "PRIORITY_NOW";
}

// Grammatical "X, Y, and Z" / "X and Y" / "X" join, used only to
// interpolate representative player names into the SAFE_TO_WAIT
// message below.
function joinWithAnd(
  names
) {
  if (
    names.length ===
    0
  ) {
    return "";
  }

  if (
    names.length ===
    1
  ) {
    return names[0];
  }

  if (
    names.length ===
    2
  ) {
    return (
      names[0] +
      " and " +
      names[1]
    );
  }

  return (
    names
      .slice(
        0,
        -1
      )
      .join(", ") +
    ", and " +
    names[
      names.length -
      1
    ]
  );
}

// Deliberately generic across positions -- one template per
// classification, not one per position -- so behavior for a position
// not explicitly anticipated (e.g. a league with a non-standard
// starting slot) is still well-defined and consistent.
//
// Wording constraints (Phase 2 product requirement):
// - never claims a head-to-head comparison against the recommended
//   player was performed (it wasn't)
// - never asserts a specific player will still be available later
// - never claims roster context changed the recommendation above
// - never phrases this as something the user MUST do
//
// SAFE_TO_WAIT wording note: does NOT describe remaining-pool depth as
// "comparable" options -- a raw headcount at a position says nothing
// about whether those players are fantasy-comparable to each other,
// and the module deliberately never computes a quality-tier count (see
// the module header for why). The message states the fact (real, named
// players remain on the board) without implying anything about their
// relative quality.
function buildMessage(
  classification,
  pos,
  representativeOptions
) {
  if (
    classification ===
    "SAFE_TO_WAIT"
  ) {
    const names =
      Array.isArray(
        representativeOptions
      )
        ? representativeOptions
        : [];

    const namesClause =
      names.length >
      0
        ? joinWithAnd(
            names
          ) +
          " are among the available options."
        : "Multiple options remain available in the pool.";

    return (
      "Your " +
      pos +
      " slot remains open. " +
      namesClause +
      " SAGE does not see a need to force the position based on remaining pool depth, but " +
      pos +
      " should continue to be monitored."
    );
  }

  if (
    classification ===
    "MONITOR"
  ) {
    return (
      pos +
      " remains open, and the remaining quality options are beginning to thin. Worth keeping an eye on over your next few picks."
    );
  }

  return (
    pos +
    " remains open, and the available options are thinning quickly. Consider addressing the position soon, before the position's depth drops further."
  );
}

// ── Entry point ──────────────────────────────────────────────────────
//
// Returns an array (possibly empty) of advisory entries, one per
// meaningful open position. Never throws -- any missing/malformed input
// simply results in fewer (or zero) entries, never an error, and never
// touches anything outside this module's own return value.
function buildRosterAdvisory(
  input
) {
  input =
    input ||
    {};

  const rosterContext =
    input.rosterContext;

  const currentPool =
    Array.isArray(
      input.currentPool
    )
      ? input.currentPool
      : [];

  if (
    !isPlainObject(
      rosterContext
    ) ||
    !isPlainObject(
      rosterContext.remainingDedicated
    )
  ) {
    return [];
  }

  const remainingDedicated =
    rosterContext.remainingDedicated;

  const numTeams =
    Number.isFinite(
      rosterContext.numTeams
    ) &&
    rosterContext.numTeams >
      0
      ? rosterContext.numTeams
      : DEFAULT_NUM_TEAMS;

  const unmetPositions =
    findUnmetPositions(
      remainingDedicated
    );

  if (
    unmetPositions.length ===
    0
  ) {
    return [];
  }

  // K/DEF should never create urgency while core offensive roster
  // construction is still incomplete -- a thin K/DEF pool this early is
  // normal and not meaningful signal. Once every core offensive
  // position is satisfied, K/DEF are evaluated normally.
  const coreOffensiveStillOpen =
    CORE_OFFENSIVE_POSITIONS.some(
      function (pos) {
        return (
          unmetPositions.indexOf(
            pos
          ) !==
          -1
        );
      }
    );

  const positionsToEvaluate =
    coreOffensiveStillOpen
      ? unmetPositions.filter(
          function (pos) {
            return (
              KDEF_POSITIONS.indexOf(
                pos
              ) ===
              -1
            );
          }
        )
      : unmetPositions;

  return positionsToEvaluate.map(
    function (pos) {
      const remainingAtPosition =
        countRemainingAtPosition(
          currentPool,
          pos
        );

      const classification =
        classifyDepth(
          remainingAtPosition,
          numTeams
        );

      const options =
        representativeNames(
          currentPool,
          pos
        );

      return {
        pos:
          pos,

        classification:
          classification,

        label:
          CLASSIFICATION_LABELS[
            classification
          ],

        message:
          buildMessage(
            classification,
            pos,
            options
          ),

        representativeOptions:
          options,

        remainingAtPosition:
          remainingAtPosition,

        remainingDedicatedNeeded:
          remainingDedicated[
            pos
          ]
      };
    }
  );
}

module.exports = {
  buildRosterAdvisory,

  _test: {
    ROSTER_POSITION_ORDER,
    CORE_OFFENSIVE_POSITIONS,
    KDEF_POSITIONS,
    CLASSIFICATION_LABELS,
    SAFE_DEPTH_MULTIPLIER,
    MONITOR_DEPTH_MULTIPLIER,
    DEFAULT_NUM_TEAMS,
    isPlainObject,
    normalizePos,
    findUnmetPositions,
    countRemainingAtPosition,
    representativeNames,
    classifyDepth,
    buildMessage,
    joinWithAnd,
    buildRosterAdvisory
  }
};
