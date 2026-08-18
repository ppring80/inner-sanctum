// netlify/functions/draft-fit-profile.js
//
// INNER SANCTUM — DRAFT FIT V1
//
// PURPOSE
// -------
// Draft Fit answers a different question from SAGE:
//
//   SAGE:
//     "How attractive is this player right now?"
//
//   Draft Fit:
//     "How attractive is this player for MY roster right now?"
//
// Draft Fit does NOT alter Opportunity, Market, Scarcity, Context,
// or SAGE synthesis. It is a separate roster-construction layer.
//
// DESIGN PRINCIPLES
// -----------------
// 1. Roster need is pressure, not a command.
// 2. Exceptional player value may override roster imbalance.
// 3. FLEX eligibility matters. A second TE is not automatically
//    redundant if that player can still occupy FLEX.
// 4. Draft Fit uses categorical, explainable decisions rather than
//    a hidden numeric score.
// 5. Draft Fit should normally break close SAGE decisions, not turn
//    a weak SAGE player into a recommendation merely because the
//    roster has an empty position.
// 6. V1 supports normal RB/WR/TE FLEX. Superflex is deliberately
//    outside V1.
//
// This module is deliberately pure:
// - no network calls
// - no Netlify Blobs
// - no DOM
// - no state writes
//
// That allows Draft Fit behavior to be tested independently before
// it is connected to the live Draft Command Center.

"use strict";

const FIT = Object.freeze({
  EXCELLENT: "excellent-fit",
  GOOD: "good-fit",
  NEUTRAL: "neutral-fit",
  PRESSURE: "roster-pressure",
  VALUE_OVERRIDE: "value-override",
});

const ACTION = Object.freeze({
  PROMOTE: "promote",
  HOLD: "hold",
  PRESSURE: "pressure",
  VALUE_OVERRIDE: "value-override",
});

const FIT_LABELS = Object.freeze({
  [FIT.EXCELLENT]: "Excellent Fit",
  [FIT.GOOD]: "Good Fit",
  [FIT.NEUTRAL]: "Neutral Fit",
  [FIT.PRESSURE]: "Roster Pressure",
  [FIT.VALUE_OVERRIDE]: "Value Override",
});

const DEFAULT_LINEUP = Object.freeze({
  QB: 1,
  RB: 2,
  WR: 2,
  TE: 1,
  FLEX: 1,
  K: 1,
  DEF: 1,
});

const FLEX_POSITIONS = Object.freeze(["RB", "WR", "TE"]);

const STRONG_SAGE_CODES = new Set([
  "take-now",
  "strong-consideration",
]);

const POSITIVE_SAGE_CODES = new Set([
  "take-now",
  "strong-consideration",
  "consider-now",
  "consider",
]);

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizePos(pos) {
  return String(pos || "").trim().toUpperCase();
}

function normalizeLineup(lineup) {
  const source = lineup || {};

  return {
    QB: Math.max(0, safeNumber(source.QB, DEFAULT_LINEUP.QB)),
    RB: Math.max(0, safeNumber(source.RB, DEFAULT_LINEUP.RB)),
    WR: Math.max(0, safeNumber(source.WR, DEFAULT_LINEUP.WR)),
    TE: Math.max(0, safeNumber(source.TE, DEFAULT_LINEUP.TE)),
    FLEX: Math.max(0, safeNumber(source.FLEX, DEFAULT_LINEUP.FLEX)),
    K: Math.max(0, safeNumber(source.K, DEFAULT_LINEUP.K)),
    DEF: Math.max(0, safeNumber(source.DEF, DEFAULT_LINEUP.DEF)),
  };
}

function countRosterByPosition(myRoster) {
  const counts = {
    QB: 0,
    RB: 0,
    WR: 0,
    TE: 0,
    K: 0,
    DEF: 0,
  };

  (Array.isArray(myRoster) ? myRoster : []).forEach((player) => {
    const pos = normalizePos(player && player.pos);

    if (Object.prototype.hasOwnProperty.call(counts, pos)) {
      counts[pos] += 1;
    }
  });

  return counts;
}

// Dedicated position slots are filled first.
//
// Only RB/WR/TE players left after their dedicated slots are filled
// compete for FLEX slots. This is the key behavior that prevents
// "TE2 = automatically redundant."
function buildRosterOccupancy(myRoster, lineup) {
  const normalizedLineup = normalizeLineup(lineup);
  const counts = countRosterByPosition(myRoster);

  const dedicatedFilled = {};
  const dedicatedOpen = {};

  ["QB", "RB", "WR", "TE", "K", "DEF"].forEach((pos) => {
    dedicatedFilled[pos] = Math.min(
      counts[pos],
      normalizedLineup[pos]
    );

    dedicatedOpen[pos] = Math.max(
      0,
      normalizedLineup[pos] - dedicatedFilled[pos]
    );
  });

  const flexEligibleExcess = FLEX_POSITIONS.reduce((total, pos) => {
    return total + Math.max(0, counts[pos] - normalizedLineup[pos]);
  }, 0);

  const flexFilled = Math.min(
    normalizedLineup.FLEX,
    flexEligibleExcess
  );

  const flexOpen = Math.max(
    0,
    normalizedLineup.FLEX - flexFilled
  );

  return {
    lineup: normalizedLineup,
    counts,
    dedicatedFilled,
    dedicatedOpen,
    flexFilled,
    flexOpen,
    flexEligibleExcess,
  };
}

function candidateCanFillDedicatedSlot(candidate, occupancy) {
  const pos = normalizePos(candidate && candidate.pos);

  return Boolean(
    occupancy &&
    occupancy.dedicatedOpen &&
    safeNumber(occupancy.dedicatedOpen[pos], 0) > 0
  );
}

function candidateCanFillFlex(candidate, occupancy) {
  const pos = normalizePos(candidate && candidate.pos);

  return (
    FLEX_POSITIONS.includes(pos) &&
    occupancy &&
    safeNumber(occupancy.flexOpen, 0) > 0 &&
    !candidateCanFillDedicatedSlot(candidate, occupancy)
  );
}

function candidateCanStart(candidate, occupancy) {
  return (
    candidateCanFillDedicatedSlot(candidate, occupancy) ||
    candidateCanFillFlex(candidate, occupancy)
  );
}

function candidateWouldBeDepth(candidate, occupancy) {
  return !candidateCanStart(candidate, occupancy);
}

function openStartingPositions(occupancy) {
  if (!occupancy) return [];

  const open = [];

  ["QB", "RB", "WR", "TE", "K", "DEF"].forEach((pos) => {
    if (safeNumber(occupancy.dedicatedOpen[pos], 0) > 0) {
      open.push(pos);
    }
  });

  if (safeNumber(occupancy.flexOpen, 0) > 0) {
    open.push("FLEX");
  }

  return open;
}

function countPositionInPool(pool, pos) {
  const target = normalizePos(pos);

  return (Array.isArray(pool) ? pool : []).reduce((count, player) => {
    return normalizePos(player && player.pos) === target
      ? count + 1
      : count;
  }, 0);
}

// V1 intentionally avoids inventing a player-quality model here.
//
// The next-turn pool has already been derived by Draft Command Center.
// Draft Fit uses it only as evidence of whether the position still has
// plausible options projected to survive.
//
// Later versions may compare SAGE quality within that pool. V1 does not
// manufacture a hidden score to do so.
function positionHasNextTurnDepth(pos, nextTurnPool) {
  return countPositionInPool(nextTurnPool, pos) > 0;
}

function getSageCode(sage) {
  if (!sage) return "";

  return String(
    sage.code ||
    sage.recommendationCode ||
    ""
  )
    .trim()
    .toLowerCase();
}

function isStrongSageValue(sage) {
  return STRONG_SAGE_CODES.has(getSageCode(sage));
}

function isPositiveSageValue(sage) {
  return POSITIVE_SAGE_CODES.has(getSageCode(sage));
}

function makeResult({
  fit,
  action,
  explanation,
  reasons,
  candidate,
  occupancy,
  canStart,
  fillsDedicated,
  fillsFlex,
  wouldBeDepth,
  nextTurnDepth,
}) {
  return {
    fit,
    label: FIT_LABELS[fit],
    action,
    explanation,
    reasons: Array.isArray(reasons) ? reasons : [],

    // Diagnostic fields are intentionally simple and deterministic.
    // They are useful for tests and server-side reasoning. The UI does
    // not have to expose all of them.
    diagnostics: {
      position: normalizePos(candidate && candidate.pos),
      canStart: Boolean(canStart),
      fillsDedicated: Boolean(fillsDedicated),
      fillsFlex: Boolean(fillsFlex),
      wouldBeDepth: Boolean(wouldBeDepth),
      nextTurnDepth: Boolean(nextTurnDepth),
      openStartingPositions: openStartingPositions(occupancy),
      flexOpen: occupancy ? safeNumber(occupancy.flexOpen, 0) : 0,
    },
  };
}

function buildDraftFitProfile(input) {
  const data = input || {};

  const candidate = data.candidate || {};
  const sage = data.sage || {};
  const myRoster = Array.isArray(data.myRoster)
    ? data.myRoster
    : [];

  const lineup = normalizeLineup(data.lineup);
  const nextTurnPool = Array.isArray(data.nextTurnPool)
    ? data.nextTurnPool
    : [];

  const pos = normalizePos(candidate.pos);
  const occupancy = buildRosterOccupancy(myRoster, lineup);

  const fillsDedicated = candidateCanFillDedicatedSlot(
    candidate,
    occupancy
  );

  const fillsFlex = candidateCanFillFlex(
    candidate,
    occupancy
  );

  const canStart = fillsDedicated || fillsFlex;
  const wouldBeDepth = candidateWouldBeDepth(
    candidate,
    occupancy
  );

  const nextTurnDepth = positionHasNextTurnDepth(
    pos,
    nextTurnPool
  );

  const strongSage = isStrongSageValue(sage);
  const positiveSage = isPositiveSageValue(sage);

  const reasons = [];

  // ------------------------------------------------------------
  // 1. Candidate fills an open dedicated starting position.
  // ------------------------------------------------------------
  if (fillsDedicated) {
    reasons.push(`fills an open starting ${pos} slot`);

    if (!nextTurnDepth && FLEX_POSITIONS.includes(pos)) {
      reasons.push(
        `${pos} options are projected to thin before the next turn`
      );

      return makeResult({
        fit: FIT.EXCELLENT,
        action: ACTION.PROMOTE,
        explanation:
          `Fills an open starting ${pos} slot while projected ${pos} depth is at risk before your next selection.`,
        reasons,
        candidate,
        occupancy,
        canStart,
        fillsDedicated,
        fillsFlex,
        wouldBeDepth,
        nextTurnDepth,
      });
    }

    return makeResult({
      fit: FIT.GOOD,
      action: ACTION.HOLD,
      explanation:
        `Adds a starting ${pos} without creating a roster conflict.`,
      reasons,
      candidate,
      occupancy,
      canStart,
      fillsDedicated,
      fillsFlex,
      wouldBeDepth,
      nextTurnDepth,
    });
  }

  // ------------------------------------------------------------
  // 2. Dedicated slot is filled, but candidate can still start
  //    through FLEX.
  //
  // This is the Brock Bowers / second elite TE protection.
  // ------------------------------------------------------------
  if (fillsFlex) {
    reasons.push(`can still enter the starting lineup through FLEX`);

    if (strongSage) {
      reasons.push(`SAGE identifies strong current value`);

      return makeResult({
        fit: FIT.GOOD,
        action: ACTION.HOLD,
        explanation:
          `${pos} is already represented, but this player can still start through FLEX and the SAGE value remains strong.`,
        reasons,
        candidate,
        occupancy,
        canStart,
        fillsDedicated,
        fillsFlex,
        wouldBeDepth,
        nextTurnDepth,
      });
    }

    return makeResult({
      fit: FIT.NEUTRAL,
      action: ACTION.HOLD,
      explanation:
        `${pos} is already represented, but FLEX remains available, so roster construction does not require a penalty.`,
      reasons,
      candidate,
      occupancy,
      canStart,
      fillsDedicated,
      fillsFlex,
      wouldBeDepth,
      nextTurnDepth,
    });
  }

  // ------------------------------------------------------------
  // 3. Candidate would currently be depth/bench.
  //
  // Before applying pressure, determine whether the roster has
  // meaningful open RB/WR/TE starting exposure.
  // ------------------------------------------------------------
  const openSkillPositions = ["RB", "WR", "TE"].filter(
    (position) =>
      safeNumber(occupancy.dedicatedOpen[position], 0) > 0
  );

  const exposedSkillPositions = openSkillPositions.filter(
    (position) => !positionHasNextTurnDepth(position, nextTurnPool)
  );

  if (wouldBeDepth && openSkillPositions.length > 0) {
    reasons.push(
      `${pos} would currently be a depth selection`
    );

    if (exposedSkillPositions.length > 0) {
      reasons.push(
        `starting ${exposedSkillPositions.join("/")} exposure may worsen before the next turn`
      );

      // Exceptional value is allowed to override roster imbalance.
      // This is deliberately categorical: SAGE has already made the
      // player-value judgment. Draft Fit does not recreate that score.
      if (strongSage) {
        reasons.push(
          `strong SAGE value justifies temporary roster imbalance`
        );

        return makeResult({
          fit: FIT.VALUE_OVERRIDE,
          action: ACTION.VALUE_OVERRIDE,
          explanation:
            `Roster balance favors ${exposedSkillPositions.join("/")} help, but the available ${pos} value is strong enough to justify temporary imbalance.`,
          reasons,
          candidate,
          occupancy,
          canStart,
          fillsDedicated,
          fillsFlex,
          wouldBeDepth,
          nextTurnDepth,
        });
      }

      return makeResult({
        fit: FIT.PRESSURE,
        action: ACTION.PRESSURE,
        explanation:
          `This player would add depth while ${exposedSkillPositions.join("/")} remains exposed before your next selection.`,
        reasons,
        candidate,
        occupancy,
        canStart,
        fillsDedicated,
        fillsFlex,
        wouldBeDepth,
        nextTurnDepth,
      });
    }

    // There are open starting positions, but the next-turn pool still
    // contains options at those positions. Do not manufacture urgency.
    if (strongSage) {
      reasons.push(
        `strong SAGE value remains more important than a non-urgent roster imbalance`
      );

      return makeResult({
        fit: FIT.VALUE_OVERRIDE,
        action: ACTION.VALUE_OVERRIDE,
        explanation:
          `Roster balance is not ideal, but projected alternatives remain available and the current SAGE value is strong enough to preserve the selection.`,
        reasons,
        candidate,
        occupancy,
        canStart,
        fillsDedicated,
        fillsFlex,
        wouldBeDepth,
        nextTurnDepth,
      });
    }

    if (positiveSage) {
      return makeResult({
        fit: FIT.PRESSURE,
        action: ACTION.PRESSURE,
        explanation:
          `This player adds depth while other starting positions remain open, although projected alternatives still exist for the next turn.`,
        reasons,
        candidate,
        occupancy,
        canStart,
        fillsDedicated,
        fillsFlex,
        wouldBeDepth,
        nextTurnDepth,
      });
    }
  }

  // ------------------------------------------------------------
  // 4. No meaningful roster-construction signal.
  //
  // Draft Fit deliberately gets out of SAGE's way.
  // ------------------------------------------------------------
  reasons.push(
    `roster construction does not create a strong reason to change the SAGE view`
  );

  return makeResult({
    fit: FIT.NEUTRAL,
    action: ACTION.HOLD,
    explanation:
      `Draft Fit is neutral here; let the SAGE player evaluation remain decisive.`,
    reasons,
    candidate,
    occupancy,
    canStart,
    fillsDedicated,
    fillsFlex,
    wouldBeDepth,
    nextTurnDepth,
  });
}

module.exports = {
  FIT,
  ACTION,
  FIT_LABELS,
  DEFAULT_LINEUP,
  FLEX_POSITIONS,

  normalizeLineup,
  countRosterByPosition,
  buildRosterOccupancy,

  candidateCanFillDedicatedSlot,
  candidateCanFillFlex,
  candidateCanStart,
  candidateWouldBeDepth,

  openStartingPositions,
  countPositionInPool,
  positionHasNextTurnDepth,

  getSageCode,
  isStrongSageValue,
  isPositiveSageValue,

  buildDraftFitProfile,
};
