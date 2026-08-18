// netlify/functions/draft-intelligence.js
//
// INNER SANCTUM — DRAFT INTELLIGENCE V1
//
// PURPOSE
// -------
// SAGE answers:
//   "How attractive is this player right now?"
//
// Draft Fit answers:
//   "How well does this player fit my roster?"
//
// Draft Intelligence answers:
//   "Given my roster, this league, the board, and when I pick again,
//    should I take this player NOW?"
//
// This module is intentionally deterministic and explainable.
// It does not replace SAGE or Draft Fit. It consumes their output.

"use strict";

const DECISION = Object.freeze({
  TAKE_NOW: "TAKE_NOW",
  STRONG_CONSIDERATION: "STRONG_CONSIDERATION",
  CONSIDER: "CONSIDER",
  WAIT: "WAIT",
});

const DEFAULT_CONFIG = Object.freeze({
  sageWeight: 0.40,
  fitWeight: 0.30,
  scarcityWeight: 0.15,
  marketWeight: 0.15,

  takeNowThreshold: 80,
  strongConsiderationThreshold: 70,
  considerThreshold: 58,

  maxMarketAdjustment: 15,
  maxScarcityAdjustment: 15,
});

function clamp(value, min, max) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return min;
  }

  return Math.min(max, Math.max(min, number));
}

function normalizeScore(value) {
  return clamp(value, 0, 100);
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }

  return Math.round(number);
}

function getCandidateName(candidate) {
  return (
    candidate?.name ||
    candidate?.playerName ||
    candidate?.player ||
    "Unknown Player"
  );
}

function getCandidatePosition(candidate) {
  return String(
    candidate?.position ||
    candidate?.pos ||
    ""
  ).toUpperCase();
}

function getSageScore(candidate) {
  const possibleScores = [
    candidate?.sageScore,
    candidate?.sage_score,
    candidate?.sage?.score,
    candidate?.score,
  ];

  for (const value of possibleScores) {
    const number = Number(value);

    if (Number.isFinite(number)) {
      return normalizeScore(number);
    }
  }

  return 50;
}

function getFitScore(candidate) {
  const possibleScores = [
    candidate?.draftFitScore,
    candidate?.fitScore,
    candidate?.fit_score,
    candidate?.draftFit?.score,
    candidate?.fit?.score,
  ];

  for (const value of possibleScores) {
    const number = Number(value);

    if (Number.isFinite(number)) {
      return normalizeScore(number);
    }
  }

  return 50;
}

function getAdp(candidate) {
  const possibleValues = [
    candidate?.adp,
    candidate?.ADP,
    candidate?.market?.adp,
  ];

  for (const value of possibleValues) {
    const number = Number(value);

    if (Number.isFinite(number) && number > 0) {
      return number;
    }
  }

  return null;
}

function calculatePicksUntilNextTurn(context = {}) {
  const explicit = Number(
    context.picksUntilNextTurn ??
    context.selectionsUntilNextPick ??
    context.picksUntilNextPick
  );

  if (Number.isFinite(explicit) && explicit >= 0) {
    return Math.round(explicit);
  }

  const currentPick = Number(context.currentPick);
  const nextPick = Number(context.nextPick);

  if (
    Number.isFinite(currentPick) &&
    Number.isFinite(nextPick) &&
    nextPick > currentPick
  ) {
    return Math.max(0, Math.round(nextPick - currentPick - 1));
  }

  return 0;
}

function calculateMarketScore(candidate, context = {}) {
  const adp = getAdp(candidate);

  if (adp === null) {
    return {
      score: 50,
      value: 0,
      label: "UNKNOWN_MARKET",
    };
  }

  const currentPick = normalizePositiveInteger(
    context.currentPick,
    Math.round(adp)
  );

  const value = currentPick - adp;

  // Positive value means the player has fallen beyond ADP.
  // Negative value means we are considering the player ahead of ADP.
  //
  // Convert approximately +/- 20 picks of market value
  // into a 0-100 market score centered at 50.

  const score = normalizeScore(50 + value * 2.5);

  let label = "AT_MARKET";

  if (value >= 8) {
    label = "STRONG_VALUE";
  } else if (value >= 3) {
    label = "VALUE";
  } else if (value <= -8) {
    label = "WELL_AHEAD_OF_MARKET";
  } else if (value <= -3) {
    label = "AHEAD_OF_MARKET";
  }

  return {
    score,
    value,
    label,
  };
}

function calculateScarcityScore(candidate, context = {}) {
  const position = getCandidatePosition(candidate);

  const availablePlayers = Array.isArray(context.availablePlayers)
    ? context.availablePlayers
    : [];

  if (!position || availablePlayers.length === 0) {
    return {
      score: 50,
      samePositionCount: null,
      label: "UNKNOWN_SCARCITY",
    };
  }

  const samePosition = availablePlayers.filter(
    (player) => getCandidatePosition(player) === position
  );

  if (samePosition.length === 0) {
    return {
      score: 100,
      samePositionCount: 0,
      label: "EXTREME_SCARCITY",
    };
  }

  const candidateSage = getSageScore(candidate);

  const viableAlternatives = samePosition.filter((player) => {
    const name = getCandidateName(player);

    if (name === getCandidateName(candidate)) {
      return false;
    }

    return getSageScore(player) >= candidateSage - 10;
  });

  const count = viableAlternatives.length;

  let score;
  let label;

  if (count <= 1) {
    score = 90;
    label = "HIGH_SCARCITY";
  } else if (count <= 3) {
    score = 75;
    label = "SCARCE";
  } else if (count <= 6) {
    score = 60;
    label = "MODERATE_SCARCITY";
  } else {
    score = 40;
    label = "DEPTH_AVAILABLE";
  }

  return {
    score,
    samePositionCount: count,
    label,
  };
}

function estimateSurvivalToNextPick(candidate, context = {}) {
  const adp = getAdp(candidate);
  const currentPick = Number(context.currentPick);
  const picksUntilNextTurn = calculatePicksUntilNextTurn(context);

  if (
    adp === null ||
    !Number.isFinite(currentPick) ||
    picksUntilNextTurn <= 0
  ) {
    return {
      probability: null,
      label: "UNKNOWN",
    };
  }

  const nextSelectionPoint = currentPick + picksUntilNextTurn + 1;
  const cushion = adp - nextSelectionPoint;

  // This is intentionally a transparent heuristic rather than
  // pretending to be a probability model.
  //
  // Large positive cushion:
  //   ADP is comfortably after our next pick -> likely survives.
  //
  // Large negative cushion:
  //   ADP occurs before our next pick -> meaningful waiting risk.

  let probability;

  if (cushion >= 15) {
    probability = 0.90;
  } else if (cushion >= 8) {
    probability = 0.75;
  } else if (cushion >= 3) {
    probability = 0.60;
  } else if (cushion >= -2) {
    probability = 0.45;
  } else if (cushion >= -8) {
    probability = 0.25;
  } else {
    probability = 0.10;
  }

  let label;

  if (probability >= 0.75) {
    label = "LIKELY_AVAILABLE";
  } else if (probability >= 0.50) {
    label = "MAY_SURVIVE";
  } else if (probability >= 0.25) {
    label = "MEANINGFUL_RISK";
  } else {
    label = "UNLIKELY_TO_SURVIVE";
  }

  return {
    probability,
    label,
  };
}

function calculateUrgencyScore(candidate, context = {}) {
  const survival = estimateSurvivalToNextPick(candidate, context);

  if (survival.probability === null) {
    return {
      score: 50,
      survival,
    };
  }

  return {
    score: normalizeScore((1 - survival.probability) * 100),
    survival,
  };
}

function buildReasons({
  candidate,
  sageScore,
  fitScore,
  market,
  scarcity,
  urgency,
}) {
  const reasons = [];

  if (sageScore >= 80) {
    reasons.push("SAGE sees a strong player opportunity.");
  } else if (sageScore >= 65) {
    reasons.push("SAGE sees a solid player opportunity.");
  }

  if (fitScore >= 80) {
    reasons.push("The player is an excellent fit for your current roster.");
  } else if (fitScore >= 65) {
    reasons.push("The player fits your current roster well.");
  } else if (fitScore < 45) {
    reasons.push("Roster fit is weaker than the player's standalone value.");
  }

  if (market.label === "STRONG_VALUE") {
    reasons.push("The player has fallen meaningfully beyond market cost.");
  } else if (market.label === "VALUE") {
    reasons.push("The player is available at a favorable market price.");
  } else if (
    market.label === "AHEAD_OF_MARKET" ||
    market.label === "WELL_AHEAD_OF_MARKET"
  ) {
    reasons.push("This selection would be ahead of the current market price.");
  }

  if (
    scarcity.label === "HIGH_SCARCITY" ||
    scarcity.label === "EXTREME_SCARCITY"
  ) {
    reasons.push(
      `Comparable ${getCandidatePosition(candidate)} options are becoming scarce.`
    );
  }

  if (urgency.survival.label === "UNLIKELY_TO_SURVIVE") {
    reasons.push("Waiting until your next pick carries substantial risk.");
  } else if (urgency.survival.label === "MEANINGFUL_RISK") {
    reasons.push("There is meaningful risk the player will not reach your next pick.");
  } else if (urgency.survival.label === "LIKELY_AVAILABLE") {
    reasons.push("The player has a reasonable chance to remain available.");
  }

  return reasons.slice(0, 4);
}

function determineDecision(score, fitScore, urgencyScore, config) {
  // Excellent player + excellent roster fit + meaningful waiting risk
  // should be actionable even if one secondary component is weaker.

  if (
    score >= config.takeNowThreshold ||
    (
      fitScore >= 80 &&
      urgencyScore >= 70 &&
      score >= config.strongConsiderationThreshold
    )
  ) {
    return DECISION.TAKE_NOW;
  }

  if (score >= config.strongConsiderationThreshold) {
    return DECISION.STRONG_CONSIDERATION;
  }

  if (score >= config.considerThreshold) {
    return DECISION.CONSIDER;
  }

  return DECISION.WAIT;
}

function evaluateDraftDecision(candidate, context = {}, options = {}) {
  if (!candidate || typeof candidate !== "object") {
    throw new TypeError("candidate must be an object");
  }

  const config = {
    ...DEFAULT_CONFIG,
    ...(options.config || {}),
  };

  const sageScore = getSageScore(candidate);
  const fitScore = getFitScore(candidate);

  const market = calculateMarketScore(candidate, context);
  const scarcity = calculateScarcityScore(candidate, context);
  const urgency = calculateUrgencyScore(candidate, context);

  // Urgency belongs inside the market/timing portion of the decision.
  // It should influence whether we act now without overwhelming
  // SAGE player quality or Draft Fit.

  const timingScore = normalizeScore(
    market.score * 0.45 +
    urgency.score * 0.55
  );

  const intelligenceScore = normalizeScore(
    sageScore * config.sageWeight +
    fitScore * config.fitWeight +
    scarcity.score * config.scarcityWeight +
    timingScore * config.marketWeight
  );

  const decision = determineDecision(
    intelligenceScore,
    fitScore,
    urgency.score,
    config
  );

  const reasons = buildReasons({
    candidate,
    sageScore,
    fitScore,
    market,
    scarcity,
    urgency,
  });

  return {
    player: getCandidateName(candidate),
    position: getCandidatePosition(candidate),

    decision,
    intelligenceScore: Number(intelligenceScore.toFixed(1)),

    components: {
      sage: Number(sageScore.toFixed(1)),
      draftFit: Number(fitScore.toFixed(1)),
      scarcity: Number(scarcity.score.toFixed(1)),
      market: Number(market.score.toFixed(1)),
      urgency: Number(urgency.score.toFixed(1)),
      timing: Number(timingScore.toFixed(1)),
    },

    market: {
      adp: getAdp(candidate),
      valueVsCurrentPick: market.value,
      label: market.label,
    },

    scarcity: {
      label: scarcity.label,
      viableSamePositionAlternatives: scarcity.samePositionCount,
    },

    nextTurn: {
      picksUntilNextTurn: calculatePicksUntilNextTurn(context),
      survivalProbability: urgency.survival.probability,
      survivalLabel: urgency.survival.label,
    },

    reasons,
  };
}

function rankDraftCandidates(candidates = [], context = {}, options = {}) {
  if (!Array.isArray(candidates)) {
    throw new TypeError("candidates must be an array");
  }

  const evaluationContext = {
    ...context,
    availablePlayers:
      context.availablePlayers || candidates,
  };

  return candidates
    .map((candidate) =>
      evaluateDraftDecision(candidate, evaluationContext, options)
    )
    .sort((a, b) => {
      if (b.intelligenceScore !== a.intelligenceScore) {
        return b.intelligenceScore - a.intelligenceScore;
      }

      if (b.components.draftFit !== a.components.draftFit) {
        return b.components.draftFit - a.components.draftFit;
      }

      return b.components.sage - a.components.sage;
    });
}

function buildTopRecommendations(
  candidates = [],
  context = {},
  options = {}
) {
  const limit = normalizePositiveInteger(options.limit, 5);

  return rankDraftCandidates(candidates, context, options)
    .slice(0, limit)
    .map((result, index) => ({
      rank: index + 1,
      ...result,
    }));
}

module.exports = {
  DECISION,
  DEFAULT_CONFIG,
  clamp,
  normalizeScore,
  calculatePicksUntilNextTurn,
  calculateMarketScore,
  calculateScarcityScore,
  estimateSurvivalToNextPick,
  calculateUrgencyScore,
  evaluateDraftDecision,
  rankDraftCandidates,
  buildTopRecommendations,
};
