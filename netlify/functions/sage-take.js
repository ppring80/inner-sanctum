// netlify/functions/sage-take.js
//
// SAGE TAKE — DETERMINISTIC EXPLANATION LAYER
//
// PURPOSE
// -------
// Turns already-finalized Weekly Rankings evidence into one short,
// customer-facing sentence (or two) explaining WHY a player is ranked
// where they are and WHAT to do about it.
//
// This is a pure, read-only explanation layer. It NEVER calculates a
// score, NEVER reorders anything, and NEVER touches rank, sageScore,
// recommendation, confidence, matchup, role, or production. It reads
// those fields and writes exactly one new field: sageTake.
//
// It makes NO network calls, NO Tank01 calls, and NO AI/API calls --
// every take is built from simple, deterministic lookups against
// fields the leaderboards and Week 1 rankings already return.
//
// FAILURE PHILOSOPHY
// -------------------
// Every exported function is wrapped so it can never throw past its
// own boundary. On any unexpected shape or error, it returns null --
// callers are expected to fall back to their existing behavior
// (the coarse sageLabel string, or the Week 1 baseline sentence).
// This module must never be able to cause a 5xx response anywhere it
// is used.
//
// NEUTRAL BASELINE
// -----------------
// Confirmed directly against all four positions' -confidence.js and
// -final-score.js files: role, production, and matchup adjustedScore
// all regress toward the same NEUTRAL_BASELINE = 50 for QB, RB, WR,
// and TE. A deviation of |adjustedScore - 50| is therefore a valid,
// already-computed, cross-position measure of "how much is this
// component pulling the score up or down" -- no new calculation.
//
// ═══════════════════════════════════════════════════════════════════════

const NEUTRAL_BASELINE = 50;
const SECONDARY_SIGNAL_FLOOR = 10;

// One shared phrase table for both Week 1 and Week 2+ -- no duplicate
// tables per position or per week.
const PHRASES = {
  component: {
    role: { strong: "a strong role", weak: "a limited role" },
    production: { strong: "strong production", weak: "limited production" }
  },
  matchup: {
    favorable: "a favorable matchup",
    even: "an even matchup",
    difficult: "a difficult matchup"
  },
  connector: { agree: "and", conflict: "despite" },
  action: {
    START: "Solid start.",
    FLEX: "Worth flex consideration.",
    SIT: "Best as a depth option this week."
  },
  confidenceQualifier: ", with slightly lower confidence"
};

// The same five-level label already used everywhere else (Matchup
// column, legend, Week 1 matchupStrength) collapses to the same three
// buckets those surfaces already use -- never a new vocabulary.
function matchupTier(label) {
  if (label === "Strong Positive" || label === "Positive") return "favorable";
  if (label === "Negative" || label === "Strong Negative") return "difficult";
  if (label === "Neutral") return "even";
  return null;
}

function connectorFor(directionA, directionB) {
  if (directionA === null || directionB === null) return PHRASES.connector.agree;
  return directionA === directionB ? PHRASES.connector.agree : PHRASES.connector.conflict;
}

function actionClause(recommendation) {
  const key = recommendation ? String(recommendation).toUpperCase() : null;
  return key && PHRASES.action[key] ? PHRASES.action[key] : null;
}

// Rank role/production/matchup by |adjustedScore - 50|. Returns up to
// two signals: the largest deviation always; the second only if it
// clears SECONDARY_SIGNAL_FLOOR. Components with no usable numeric
// adjustedScore are excluded as candidates entirely (never treated as
// neutral/zero).
function selectSignals(components) {
  const candidates = [];

  ["role", "production", "matchup"].forEach(function (key) {
    const entry = components[key];
    const score = entry && typeof entry.adjustedScore === "number" ? entry.adjustedScore : null;
    if (score === null) return;

    candidates.push({
      key: key,
      deviation: score - NEUTRAL_BASELINE,
      direction: score >= NEUTRAL_BASELINE ? "up" : "down"
    });
  });

  candidates.sort(function (a, b) {
    return Math.abs(b.deviation) - Math.abs(a.deviation);
  });

  if (!candidates.length) return [];

  const selected = [candidates[0]];

  if (candidates[1] && Math.abs(candidates[1].deviation) >= SECONDARY_SIGNAL_FLOOR) {
    selected.push(candidates[1]);
  }

  return selected;
}

function componentPhrase(signal, matchupLabel) {
  if (signal.key === "matchup") {
    const tier = matchupLabel ? matchupTier(matchupLabel) : null;
    return tier ? PHRASES.matchup[tier] : null;
  }

  const bucket = signal.direction === "up" ? "strong" : "weak";
  return PHRASES.component[signal.key] ? PHRASES.component[signal.key][bucket] : null;
}

// WEEK 1 TIER SYSTEM
// -------------------
// Distinguishes players within the same recommendation using
// positionRank -- already computed, already returned, never ADP
// language. Fixed, position-agnostic cutoffs (top 5 / top 12) are
// used only to pick WORDING within a tier the recommendation has
// already decided; they can never contradict recommendation, since
// "elite"/"strong"/"lower" only apply when recommendation is already
// START, "flex" only when it is already FLEX, and "bench" only when
// it is already SIT.
function week1Tier(recommendation, positionRank) {
  const rec = recommendation ? String(recommendation).toUpperCase() : null;
  const rank = typeof positionRank === "number" ? positionRank : null;

  if (rec === "START") {
    if (rank !== null && rank <= 5) return "elite";
    if (rank !== null && rank <= 12) return "strong";
    return "lower";
  }

  if (rec === "FLEX") return "flex";
  if (rec === "SIT") return "bench";
  return null;
}

const WEEK1_TIER_ACTION = {
  elite: "Keep him locked in.",
  strong: "Confident start.",
  lower: "Still a Week 1 start.",
  flex: "Worth flex consideration.",
  bench: "Best as a depth option this week."
};

// One hand-tuned opening sentence per tier x matchup combination.
// Deliberately explicit rather than mechanically assembled from
// fragments -- this is what actually produces natural, varied,
// player-specific prose instead of a formula that always reads the
// same way. Every entry describes only recommendation/positionRank/
// matchup -- no fabricated role, production, or regular-season
// evidence, and no "ADP" wording anywhere.
const WEEK1_OPENING = {
  elite: {
    favorable: "Elite Week 1 profile with a favorable matchup on top.",
    even: "Elite Week 1 profile in an even matchup.",
    difficult: "Elite Week 1 profile even with a difficult matchup.",
    none: "Elite Week 1 profile."
  },
  strong: {
    favorable: "Strong starter profile with the matchup working in his favor.",
    even: "Strong starter profile in an even matchup.",
    difficult: "Strong starter profile despite a difficult matchup.",
    none: "Strong starter profile."
  },
  lower: {
    favorable: "Lower-end starter range, but the favorable matchup helps.",
    even: "Lower-end starter range in an even matchup.",
    difficult: "Lower-end starter range, and the matchup doesn't do him any favors.",
    none: "Lower-end starter range."
  },
  flex: {
    favorable: "The matchup helps, but he remains outside the preferred starter tier.",
    even: "Flex-range profile in an even matchup.",
    difficult: "Flex-range profile, and a difficult matchup doesn't help his case.",
    none: "Flex-range profile."
  },
  bench: {
    favorable: "The matchup is favorable, but he's still a bench-caliber option.",
    even: "Bench-caliber Week 1 outlook.",
    difficult: "Bench-caliber Week 1 outlook, and a difficult matchup doesn't help.",
    none: "Bench-caliber Week 1 outlook."
  }
};

function buildWeek1Take(player) {
  const tier = week1Tier(player.recommendation, player.positionRank);
  const matchupKey = player.matchupStrength ? matchupTier(player.matchupStrength) : null;

  if (!tier) {
    // No usable recommendation/positionRank signal at all. Fall back
    // to matchup alone if that's the only evidence present; never
    // fabricate a tier.
    return matchupKey ? "In " + PHRASES.matchup[matchupKey] + " this week." : null;
  }

  const opening = WEEK1_OPENING[tier][matchupKey || "none"];
  const action = WEEK1_TIER_ACTION[tier];

  return opening + " " + action;
}

function buildWeek2PlusTake(player) {
  const signals = selectSignals(player);
  const action = actionClause(player.recommendation);

  if (!signals.length) return null;

  const phrases = signals
    .map(function (signal) {
      return { text: componentPhrase(signal, player.matchup && player.matchup.label), direction: signal.direction, key: signal.key };
    })
    .filter(function (entry) {
      return !!entry.text;
    });

  if (!phrases.length) return null;

  let why;

  if (phrases.length === 1) {
    const lead = phrases[0].key === "matchup" ? "This week's " + phrases[0].text.replace(/^a[n]? /, "") : capitalize(phrases[0].text);
    why = lead + " is driving the ranking.";
  } else if (connectorFor(phrases[0].direction, phrases[1].direction) === PHRASES.connector.conflict) {
    // "X is driving the ranking despite Y." -- matches the approved
    // tone example exactly; "despite" does not form a compound
    // subject, so it cannot share a plural verb with "and".
    why = capitalize(phrases[0].text) + " is driving the ranking despite " + phrases[1].text + ".";
  } else {
    // "X and Y support the ranking." -- compound subject, plural verb.
    why = capitalize(phrases[0].text) + " " + PHRASES.connector.agree + " " + phrases[1].text + " support the ranking.";
  }

  const qualifier =
    player.sageConfidenceLabel &&
    player.sageConfidenceLabel !== "Full" &&
    player.sageConfidenceLabel !== "High"
      ? PHRASES.confidenceQualifier
      : "";

  const actionSentence = action ? action.replace(/\.$/, "") + qualifier + "." : null;

  return [why, actionSentence].filter(Boolean).join(" ");
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Wraps a builder so it can never throw past this module's boundary.
function safe(builder) {
  return function (player) {
    try {
      const take = builder(player || {});
      return typeof take === "string" && take.trim() ? take.trim() : null;
    } catch (error) {
      return null;
    }
  };
}

exports.buildWeek1SageTake = safe(buildWeek1Take);
exports.buildWeek2PlusSageTake = safe(buildWeek2PlusTake);
