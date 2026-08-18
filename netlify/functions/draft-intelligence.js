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
//   "How well does this player fit MY roster right now?"
//
// Draft Intelligence answers:
//   "Given both of those things, should I take this player now,
//    and how should this player rank against my other choices?"
//
// IMPORTANT DESIGN RULES
// ----------------------
// 1. SAGE remains the underlying player evaluation.
// 2. Draft Fit remains categorical and explainable.
// 3. No hidden Draft Fit numeric score is created here.
// 4. Draft Intelligence may adjust a decision when SAGE choices are close.
// 5. Roster need is pressure, not a command.
// 6. Exceptional value may override temporary roster imbalance.
// 7. Waiting risk matters because the user may not pick again for many turns.
// 8. Adjustments are deliberately limited to ONE recommendation tier.
//
// This module is pure:
// - no network calls
// - no Netlify Blobs
// - no DOM
// - no state writes

"use strict";

const SAGE_CODES = Object.freeze([
  "take-now",
  "strong-consideration",
  "consider-now",
  "consider",
  "can-wait",
  "flexible",
  "caution",
  "wait",
  "pass-for-now",
  "needs-more-evidence",
]);

const DECISION_LABELS = Object.freeze({
  "take-now": "Take Now",
  "strong-consideration": "Strong Consideration",
  "consider-now": "Consider Now",
  "consider": "Consider",
  "can-wait": "Can Wait",
  "flexible": "Flexible",
  "caution": "Caution",
  "wait": "Wait",
  "pass-for-now": "Pass For Now",
  "needs-more-evidence": "Needs More Evidence",
});

const FIT_PRIORITY = Object.freeze({
  "value-override": 0,
  "excellent-fit": 1,
  "good-fit": 2,
  "neutral-fit": 3,
  "roster-pressure": 4,
});

const WAITING_RISK = Object.freeze({
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  UNKNOWN: "unknown",
});

function safeNumber(value, fallback = null) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function normalizePos(pos) {
  return String(pos || "")
    .trim()
    .toUpperCase();
}

function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[.\u0027\u2018\u2019]/g, "")
    .replace(/-/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function playerKey(player) {
  return (
    normalizeName(player && player.name) +
    "|" +
    normalizePos(player && player.pos)
  );
}

function getSageCode(sage) {
  const code = String(
    (sage && (
      sage.code ||
      sage.recommendationCode
    )) ||
    ""
  )
    .trim()
    .toLowerCase();

  return SAGE_CODES.includes(code)
    ? code
    : "needs-more-evidence";
}

function sageRank(code) {
  const index = SAGE_CODES.indexOf(code);

  return index >= 0
    ? index
    : SAGE_CODES.length - 1;
}

function codeFromRank(rank) {
  const safeRank = Math.max(
    0,
    Math.min(
      SAGE_CODES.length - 1,
      Math.round(rank)
    )
  );

  return SAGE_CODES[safeRank];
}

function getFitCode(draftFit) {
  return String(
    (draftFit && draftFit.fit) ||
    "neutral-fit"
  )
    .trim()
    .toLowerCase();
}

function getFitAction(draftFit) {
  return String(
    (draftFit && draftFit.action) ||
    "hold"
  )
    .trim()
    .toLowerCase();
}

function getFitPriority(draftFit) {
  const fit = getFitCode(draftFit);

  return Object.prototype.hasOwnProperty.call(
    FIT_PRIORITY,
    fit
  )
    ? FIT_PRIORITY[fit]
    : FIT_PRIORITY["neutral-fit"];
}

function getAdp(candidate) {
  const adp = safeNumber(
    candidate && candidate.adp,
    null
  );

  return adp !== null && adp > 0
    ? adp
    : null;
}

function candidateAppearsInNextTurnPool(
  candidate,
  nextTurnPool
) {
  if (!Array.isArray(nextTurnPool)) {
    return false;
  }

  const key = playerKey(candidate);

  return nextTurnPool.some(
    (player) => playerKey(player) === key
  );
}

function positionAppearsInNextTurnPool(
  candidate,
  nextTurnPool
) {
  if (!Array.isArray(nextTurnPool)) {
    return false;
  }

  const pos = normalizePos(
    candidate && candidate.pos
  );

  return nextTurnPool.some(
    (player) =>
      normalizePos(player && player.pos) === pos
  );
}

// Waiting risk is deliberately categorical.
//
// We first trust the projected next-turn pool because Draft Command
// Center already derives that from the live draft state.
//
// ADP is used only as additional evidence when the projected pool
// cannot answer the question directly.
function evaluateWaitingRisk(
  candidate,
  context
) {
  const data = context || {};

  const nextTurnPool = Array.isArray(
    data.nextTurnPool
  )
    ? data.nextTurnPool
    : [];

  const currentPick = safeNumber(
    data.currentPick,
    null
  );

  const nextUserPick = safeNumber(
    data.nextUserPick,
    safeNumber(data.nextPick, null)
  );

  const adp = getAdp(candidate);

  if (nextTurnPool.length > 0) {
    if (
      candidateAppearsInNextTurnPool(
        candidate,
        nextTurnPool
      )
    ) {
      return {
        level: WAITING_RISK.LOW,
        reason:
          "This player is projected to remain available at your next turn.",
      };
    }

    if (
      !positionAppearsInNextTurnPool(
        candidate,
        nextTurnPool
      )
    ) {
      return {
        level: WAITING_RISK.HIGH,
        reason:
          `${normalizePos(candidate.pos)} depth is projected to thin before your next turn.`,
      };
    }

    return {
      level: WAITING_RISK.MEDIUM,
      reason:
        "Comparable positional options may remain, but this specific player is not projected to survive.",
    };
  }

  if (
    adp !== null &&
    nextUserPick !== null
  ) {
    if (adp <= nextUserPick - 5) {
      return {
        level: WAITING_RISK.HIGH,
        reason:
          "Market position suggests meaningful risk that this player will be gone before your next pick.",
      };
    }

    if (adp <= nextUserPick + 3) {
      return {
        level: WAITING_RISK.MEDIUM,
        reason:
          "The player's market range overlaps your next selection.",
      };
    }

    return {
      level: WAITING_RISK.LOW,
      reason:
        "Market position suggests there may be room to wait.",
    };
  }

  if (
    adp !== null &&
    currentPick !== null &&
    adp <= currentPick
  ) {
    return {
      level: WAITING_RISK.HIGH,
      reason:
        "The player is already available beyond his market expectation.",
    };
  }

  return {
    level: WAITING_RISK.UNKNOWN,
    reason:
      "Waiting risk cannot be established confidently from the available draft state.",
  };
}

// Draft Intelligence is intentionally restrained.
//
// A Draft Fit signal may move a player by AT MOST one SAGE tier.
//
// Examples:
//
// consider-now + excellent fit + high waiting risk
//   -> strong-consideration
//
// take-now + roster pressure
//   -> strong-consideration
//
// take-now + value override
//   -> take-now
//
// A weak underlying SAGE player cannot suddenly become Take Now
// just because the roster has an empty position.
function determineDecisionRank(
  sage,
  draftFit,
  waitingRisk
) {
  const baseCode = getSageCode(sage);
  const baseRank = sageRank(baseCode);

  const fit = getFitCode(draftFit);
  const action = getFitAction(draftFit);

  let adjustedRank = baseRank;
  let adjustment = "none";

  // Exceptional value protection.
  if (
    fit === "value-override" ||
    action === "value-override"
  ) {
    return {
      baseCode,
      baseRank,
      decisionRank: baseRank,
      decisionCode: baseCode,
      adjustment: "value-override",
    };
  }

  // Excellent fit only promotes when waiting carries real danger.
  if (
    action === "promote" &&
    (
      waitingRisk.level === WAITING_RISK.HIGH ||
      waitingRisk.level === WAITING_RISK.MEDIUM
    )
  ) {
    adjustedRank = Math.max(
      0,
      baseRank - 1
    );

    if (adjustedRank !== baseRank) {
      adjustment = "promoted-one-tier";
    }
  }

  // Roster pressure may restrain a strong recommendation,
  // but never by more than one tier.
  if (action === "pressure") {
    adjustedRank = Math.min(
      SAGE_CODES.length - 1,
      baseRank + 1
    );

    if (adjustedRank !== baseRank) {
      adjustment = "restrained-one-tier";
    }
  }

  return {
    baseCode,
    baseRank,
    decisionRank: adjustedRank,
    decisionCode: codeFromRank(
      adjustedRank
    ),
    adjustment,
  };
}

function buildExplanation({
  candidate,
  sage,
  draftFit,
  waitingRisk,
  decision,
}) {
  const fitLabel =
    (draftFit && draftFit.label) ||
    "Neutral Fit";

  if (
    decision.adjustment ===
    "value-override"
  ) {
    return (
      `SAGE value is strong enough to preserve the recommendation despite roster imbalance. ` +
      `${fitLabel}: ${draftFit.explanation || "temporary roster imbalance is acceptable."}`
    );
  }

  if (
    decision.adjustment ===
    "promoted-one-tier"
  ) {
    return (
      `${fitLabel} strengthens the case for acting now. ` +
      waitingRisk.reason
    );
  }

  if (
    decision.adjustment ===
    "restrained-one-tier"
  ) {
    return (
      `The player remains attractive, but roster construction reduces the urgency. ` +
      `${draftFit.explanation || ""}`
    ).trim();
  }

  return (
    `${fitLabel}. ` +
    (
      draftFit &&
      draftFit.explanation
        ? draftFit.explanation
        : waitingRisk.reason
    )
  );
}

function evaluateDraftIntelligence(
  input,
  context
) {
  const data = input || {};

  const candidate =
    data.candidate || {};

  const sage =
    data.sage || {};

  const draftFit =
    data.draftFit || {};

  const waitingRisk =
    evaluateWaitingRisk(
      candidate,
      context || {}
    );

  const decision =
    determineDecisionRank(
      sage,
      draftFit,
      waitingRisk
    );

  return {
    player: {
      name:
        candidate.name ||
        "",
      pos:
        normalizePos(
          candidate.pos
        ),
      team:
        candidate.team ||
        "",
    },

    adp: getAdp(candidate),

    sage: {
      recommendation:
        sage.recommendation ||
        DECISION_LABELS[
          decision.baseCode
        ] ||
        "",
      code:
        decision.baseCode,
    },

    draftFit: {
      fit:
        getFitCode(draftFit),
      label:
        draftFit.label ||
        "Neutral Fit",
      action:
        getFitAction(draftFit),
      explanation:
        draftFit.explanation ||
        "",
      reasons:
        Array.isArray(
          draftFit.reasons
        )
          ? draftFit.reasons
          : [],
    },

    waitingRisk,

    decision: {
      recommendation:
        DECISION_LABELS[
          decision.decisionCode
        ] ||
        decision.decisionCode,

      code:
        decision.decisionCode,

      adjustment:
        decision.adjustment,

      explanation:
        buildExplanation({
          candidate,
          sage,
          draftFit,
          waitingRisk,
          decision,
        }),
    },

    diagnostics: {
      sageRank:
        decision.baseRank,

      decisionRank:
        decision.decisionRank,

      fitPriority:
        getFitPriority(
          draftFit
        ),
    },
  };
}

function rankDraftIntelligence(
  candidates,
  context
) {
  const list = Array.isArray(
    candidates
  )
    ? candidates
    : [];

  return list
    .map((entry) =>
      evaluateDraftIntelligence(
        entry,
        context || {}
      )
    )
    .sort((a, b) => {
      // 1. Final Draft Intelligence decision.
      if (
        a.diagnostics.decisionRank !==
        b.diagnostics.decisionRank
      ) {
        return (
          a.diagnostics.decisionRank -
          b.diagnostics.decisionRank
        );
      }

      // 2. Draft Fit breaks close decisions.
      if (
        a.diagnostics.fitPriority !==
        b.diagnostics.fitPriority
      ) {
        return (
          a.diagnostics.fitPriority -
          b.diagnostics.fitPriority
        );
      }

      // 3. Original SAGE strength remains relevant.
      if (
        a.diagnostics.sageRank !==
        b.diagnostics.sageRank
      ) {
        return (
          a.diagnostics.sageRank -
          b.diagnostics.sageRank
        );
      }

      // 4. ADP remains the objective final tie-breaker,
      // matching the existing SAGE endpoint convention.
      const adpA =
        a.adp === null
          ? Number.POSITIVE_INFINITY
          : a.adp;

      const adpB =
        b.adp === null
          ? Number.POSITIVE_INFINITY
          : b.adp;

      return adpA - adpB;
    });
}

function buildTopDraftRecommendations(
  candidates,
  context,
  limit
) {
  const max =
    Number.isFinite(
      Number(limit)
    ) &&
    Number(limit) > 0
      ? Math.round(
          Number(limit)
        )
      : 5;

  return rankDraftIntelligence(
    candidates,
    context
  )
    .slice(0, max)
    .map(
      (result, index) => ({
        rank:
          index + 1,
        ...result,
      })
    );
}

module.exports = {
  SAGE_CODES,
  DECISION_LABELS,
  FIT_PRIORITY,
  WAITING_RISK,

  normalizePos,
  normalizeName,
  playerKey,

  getSageCode,
  sageRank,
  codeFromRank,

  getFitCode,
  getFitAction,
  getFitPriority,

  getAdp,

  candidateAppearsInNextTurnPool,
  positionAppearsInNextTurnPool,
  evaluateWaitingRisk,

  determineDecisionRank,
  evaluateDraftIntelligence,
  rankDraftIntelligence,
  buildTopDraftRecommendations,
};
