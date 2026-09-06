// ═══════════════════════════════════════════════════════════
// DECISION ENGINE — Phase 1 (post-pick, deterministic only)
// ═══════════════════════════════════════════════════════════
// Answers one question after every logged pick in the Auction War Room:
// "Given everything that has happened in the auction so far, who should
//  I target next, and what is the maximum price I should be willing to pay?"
//
// Scope, per the Aug 12 2026 session decision:
//   - No live nomination / current-bid capture (that's a separate,
//     later phase — see /areas/inner-sanctum.md).
//   - No LLM adjudication — deterministic scoring only.
//   - No tier-list refactor — ADP/price-sheet rank is the scarcity proxy.
//   - Inflation math is intentionally DUPLICATED from updateTrackerStats()
//     in auction.html, not shared/refactored, to keep this pass's
//     regression surface small. Centralize later once this is proven.
//
// This file is pure logic — no DOM access. It reads a snapshot of
// auction.html's `state` object (plus the separate `allPlayers` array)
// and returns a plain result object for auction.html to render.
// ═══════════════════════════════════════════════════════════

// ─── TUNABLE CONSTANTS ────────────────────────────────────
// Scoring weights (must sum to 1.0)
var WEIGHT_VALUE      = 0.35;  // value vs. target price
var WEIGHT_NEED        = 0.25;  // positional need
var WEIGHT_INFLATION   = 0.20;  // positional-inflation-adjusted value
var WEIGHT_STRATEGY    = 0.15;  // strategy fit
var WEIGHT_BUDGET      = 0.05;  // budget flexibility

// Action classification thresholds, applied to finalScore (0–1)
var THRESHOLD_TARGET = 0.70;
var THRESHOLD_WATCH  = 0.45;

// Hard-rule budget math
var MIN_SLOT_RESERVE_DOLLARS = 1;

var MIN_POSITIONAL_SAMPLE_FOR_INFLATION = 2;

var INFLATION_SCORE_NEUTRAL = 0.5;

var NEED_SCORE_DIRECT = 1.0;
var NEED_SCORE_FLEX   = 0.6;
var NEED_SCORE_BENCH  = 0.3;
var NEED_SCORE_NONE   = 0.0;

var STRATEGY_SCORE_NEUTRAL = 0.5;

// ─── MULTI-RECOMMENDATION ROLE-SELECTION CONSTANTS ────────

var ALTERNATIVE_TARGET_CLOSE_SCORE_MARGIN = 0.15;

var VALUE_TARGET_DIVERSITY_RELATIVE_MARGIN = 0.9;

var VALUE_ROLE_WEIGHT_VALUE = 0.5;
var VALUE_ROLE_WEIGHT_BUDGET = 0.3;
var VALUE_ROLE_WEIGHT_INFLATION = 0.2;

var MORE_TARGETS_COUNT = 5;

// Show More portfolio diversity (Sep 6 2026): when a candidate at a
// position not yet represented in the recommendation portfolio is at least
// 90% as strong by the EXISTING finalScore as the best remaining candidate,
// prefer that different-position path. This is selection-only: no player is
// rescored, Primary/Alternative/Value are untouched, and a materially
// stronger same-position candidate still wins when the alternative falls
// outside the margin.
var MORE_TARGETS_DIVERSITY_RELATIVE_MARGIN = 0.9;

var SCORING_FORMAT_LABELS = {
  standard: 'Values reflect Standard scoring.',
  half: 'Values reflect Half PPR scoring.',
  ppr: 'Values reflect PPR scoring.'
};

var POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

var DECISION_FLEX_ELIGIBLE_POSITIONS = ['RB', 'WR', 'TE'];

var CORE_OFFENSIVE_STARTER_POSITIONS = ['QB', 'RB', 'WR', 'TE'];
var LATE_DRAFT_ONLY_POSITIONS = ['K', 'DEF'];

var ROSTER_SLOT_KEYS = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BENCH'];

var STRATEGY_FAVORED_POSITIONS = {
  rb:   [{ pos: 'RB', share: 1.0 }],
  wr:   [{ pos: 'WR', share: 1.0 }],
  qb:   [{ pos: 'QB', share: 1.0 }],
  hero: [{ pos: 'RB', share: 0.5 }, { pos: 'WR', share: 0.5 }]
};

// ─── SMALL HELPERS ────────────────────────────────────────

function normalizePos(pos) {
  return (pos || '').toString().toUpperCase().trim();
}

function clamp01(n) {
  if (isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

// ─── DERIVE: TEAM BUDGETS REMAINING ───────────────────────

function deriveTeamBudgets(draftLog, budget, teamNames) {
  var spent = {};

  (teamNames || []).forEach(function (t) {
    spent[t] = 0;
  });

  (draftLog || []).forEach(function (p) {
    if (spent[p.team] === undefined) spent[p.team] = 0;
    spent[p.team] += (p.price || 0);
  });

  var remaining = {};

  Object.keys(spent).forEach(function (t) {
    remaining[t] = budget - spent[t];
  });

  return remaining;
}

// ─── DERIVE: USER ROSTER FILLED / OPEN ────────────────────

function deriveUserRoster(draftLog, userTeam, rosterTargets) {
  var draftedByPos = {};

  POSITIONS.forEach(function (p) {
    draftedByPos[p] = 0;
  });

  (draftLog || []).forEach(function (p) {
    if (p.team !== userTeam) return;

    var pos = normalizePos(p.pos);

    if (draftedByPos[pos] !== undefined) {
      draftedByPos[pos]++;
    }
  });

  var filledDirect = {};
  var leftoverAfterDirect = {};

  POSITIONS.forEach(function (pos) {
    var target = rosterTargets[pos] || 0;
    var drafted = draftedByPos[pos] || 0;

    filledDirect[pos] = Math.min(drafted, target);
    leftoverAfterDirect[pos] = Math.max(0, drafted - target);
  });

  var flexPool = DECISION_FLEX_ELIGIBLE_POSITIONS.reduce(function (sum, p) {
    return sum + leftoverAfterDirect[p];
  }, 0);

  var flexTarget = rosterTargets.FLEX || 0;
  var flexFilled = Math.min(flexPool, flexTarget);
  var flexRemainingCapacity = Math.max(0, flexTarget - flexFilled);

  var totalLeftover = POSITIONS.reduce(function (sum, p) {
    return sum + leftoverAfterDirect[p];
  }, 0);

  var totalLeftoverAfterFlex = Math.max(0, totalLeftover - flexFilled);

  var benchTarget = rosterTargets.BENCH || 0;
  var benchFilled = Math.min(totalLeftoverAfterFlex, benchTarget);
  var benchRemainingCapacity = Math.max(0, benchTarget - benchFilled);

  var openDirect = {};

  POSITIONS.forEach(function (pos) {
    openDirect[pos] = Math.max(
      0,
      (rosterTargets[pos] || 0) - filledDirect[pos]
    );
  });

  return {
    draftedByPos: draftedByPos,
    filledDirect: filledDirect,
    openDirect: openDirect,

    flexTarget: flexTarget,
    flexFilled: flexFilled,
    flexRemainingCapacity: flexRemainingCapacity,

    benchTarget: benchTarget,
    benchFilled: benchFilled,
    benchRemainingCapacity: benchRemainingCapacity,

    rosterTargets: rosterTargets
  };
}

function hasOpenSlotForPosition(pos, userRoster) {
  if (!userRoster) return false;

  pos = normalizePos(pos);

  if (
    (pos === 'K' || pos === 'DEF') &&
    (userRoster.rosterTargets[pos] || 0) === 0
  ) {
    return false;
  }

  if ((userRoster.openDirect[pos] || 0) > 0) {
    return true;
  }

  if (
    DECISION_FLEX_ELIGIBLE_POSITIONS.indexOf(pos) !== -1 &&
    userRoster.flexRemainingCapacity > 0
  ) {
    return true;
  }

  if (userRoster.benchRemainingCapacity > 0) {
    return true;
  }

  return false;
}

function hasOpenCoreOffensiveStarterSlot(userRoster) {
  if (!userRoster) return true;

  var anyDirectOpen = CORE_OFFENSIVE_STARTER_POSITIONS.some(function (pos) {
    return (userRoster.openDirect[pos] || 0) > 0;
  });

  return anyDirectOpen || userRoster.flexRemainingCapacity > 0;
}

function computeNeedScore(pos, userRoster) {
  if (!userRoster) return NEED_SCORE_NONE;

  pos = normalizePos(pos);

  if ((userRoster.openDirect[pos] || 0) > 0) {
    return NEED_SCORE_DIRECT;
  }

  if (
    DECISION_FLEX_ELIGIBLE_POSITIONS.indexOf(pos) !== -1 &&
    userRoster.flexRemainingCapacity > 0
  ) {
    return NEED_SCORE_FLEX;
  }

  if (userRoster.benchRemainingCapacity > 0) {
    return NEED_SCORE_BENCH;
  }

  return NEED_SCORE_NONE;
}

// ─── DERIVE: REMAINING PLAYERS ────────────────────────────

function derivePlayersRemaining(allPlayers, draftLog, playerPriceLookup) {
  var draftedNames = {};

  (draftLog || []).forEach(function (p) {
    draftedNames[(p.player || '').toLowerCase()] = true;
  });

  var remaining = [];
  var unscored = [];

  (allPlayers || []).forEach(function (p) {
    var key = (p.name || '').toLowerCase();

    if (draftedNames[key]) return;

    var price = playerPriceLookup
      ? playerPriceLookup[key]
      : undefined;

    if (typeof price === 'number') {
      remaining.push({
        name: p.name,
        pos: normalizePos(p.pos),
        team: p.team,
        targetPrice: price
      });
    } else {
      unscored.push({
        name: p.name,
        pos: normalizePos(p.pos),
        team: p.team,
        reasonCode: 'UNSCORED_NO_TARGET_PRICE'
      });
    }
  });

  return {
    remaining: remaining,
    unscored: unscored
  };
}

// ─── DERIVE: INFLATION ────────────────────────────────────

function deriveGlobalInflation(draftLog) {
  var withProjection = (draftLog || []).filter(function (p) {
    return p.projected && p.projected > 0;
  });

  if (!withProjection.length) {
    return 0;
  }

  var avgRatio =
    withProjection.reduce(function (a, p) {
      return a + (p.price / p.projected);
    }, 0) / withProjection.length;

  return avgRatio - 1;
}

function derivePositionalInflation(draftLog, globalInflation) {
  var byPos = {};

  POSITIONS.forEach(function (pos) {
    var picks = (draftLog || []).filter(function (p) {
      return (
        normalizePos(p.pos) === pos &&
        p.projected &&
        p.projected > 0
      );
    });

    if (picks.length < MIN_POSITIONAL_SAMPLE_FOR_INFLATION) {
      byPos[pos] = {
        inflation: globalInflation,
        sampleSize: picks.length,
        usedFallback: true
      };
    } else {
      var avgRatio =
        picks.reduce(function (a, p) {
          return a + (p.price / p.projected);
        }, 0) / picks.length;

      byPos[pos] = {
        inflation: avgRatio - 1,
        sampleSize: picks.length,
        usedFallback: false
      };
    }
  });

  return byPos;
}

// ─── BUILD DECISION STATE ─────────────────────────────────

function buildDecisionState(state, allPlayers) {
  var userTeam = state.userTeam || null;
  var draftLog = state.draftLog || [];
  var teamNames = state.teamNames || [];
  var budget = state.budget || 0;
  var rosterTargets = state.roster || {};
  var strategyKey = state.strategy || null;
  var scoringFormat = state.scoring || null;
  var playerPriceLookup = state.playerPriceLookup || {};
  var defRankLookup = state.defRankLookup || {};

  var teamBudgetsRemaining =
    deriveTeamBudgets(
      draftLog,
      budget,
      teamNames
    );

  var userRoster =
    userTeam
      ? deriveUserRoster(
          draftLog,
          userTeam,
          rosterTargets
        )
      : null;

  var derivedPlayers =
    derivePlayersRemaining(
      allPlayers,
      draftLog,
      playerPriceLookup
    );

  var globalInflation =
    deriveGlobalInflation(draftLog);

  var positionalInflation =
    derivePositionalInflation(
      draftLog,
      globalInflation
    );

  var userDraftedCount =
    draftLog.filter(function (p) {
      return p.team === userTeam;
    }).length;

  var totalRosterSlots =
    ROSTER_SLOT_KEYS.reduce(function (sum, k) {
      return sum + (rosterTargets[k] || 0);
    }, 0);

  var totalOpenSlots =
    Math.max(
      0,
      totalRosterSlots - userDraftedCount
    );

  var userBudgetRemaining =
    userTeam
      ? (
          teamBudgetsRemaining[userTeam] != null
            ? teamBudgetsRemaining[userTeam]
            : budget
        )
      : null;

  var maxAffordable = 0;

  if (userTeam && totalOpenSlots > 0) {
    maxAffordable = Math.max(
      0,
      userBudgetRemaining -
        (
          (totalOpenSlots - 1) *
          MIN_SLOT_RESERVE_DOLLARS
        )
    );
  }

  return {
    userTeam: userTeam,
    rosterTargets: rosterTargets,
    strategyKey: strategyKey,
    scoringFormat: scoringFormat,
    defRankLookup: defRankLookup,

    teamBudgetsRemaining: teamBudgetsRemaining,
    userRoster: userRoster,
    userBudgetRemaining: userBudgetRemaining,

    totalRosterSlots: totalRosterSlots,
    totalOpenSlots: totalOpenSlots,
    maxAffordable: maxAffordable,

    remaining: derivedPlayers.remaining,
    unscored: derivedPlayers.unscored,

    globalInflation: globalInflation,
    positionalInflation: positionalInflation
  };
}

// ─── HARD RULES ───────────────────────────────────────────

function applyHardRules(player, decisionState) {
  if (player.targetPrice > decisionState.maxAffordable) {
    return {
      vetoed: true,
      code: 'HARD_RULE_BUDGET_CAP'
    };
  }

  if (
    !hasOpenSlotForPosition(
      player.pos,
      decisionState.userRoster
    )
  ) {
    return {
      vetoed: true,
      code: 'HARD_RULE_NO_OPEN_SLOT'
    };
  }

  return {
    vetoed: false
  };
}

// ─── SCORING FACTORS ──────────────────────────────────────

function computeValueScore(player, decisionState) {
  var samePos =
    decisionState.remaining.filter(function (p) {
      return (
        p.pos === player.pos &&
        p.targetPrice <= decisionState.maxAffordable
      );
    });

  var prices =
    samePos.map(function (p) {
      return p.targetPrice;
    });

  if (!prices.length) {
    return 0;
  }

  var maxP = Math.max.apply(null, prices);
  var minP = Math.min.apply(null, prices);

  if (maxP === minP) {
    return 1;
  }

  return (
    (player.targetPrice - minP) /
    (maxP - minP)
  );
}

function computeStrategyScore(pos, strategyKey) {
  if (
    !strategyKey ||
    strategyKey === 'custom'
  ) {
    return STRATEGY_SCORE_NEUTRAL;
  }

  var favored =
    STRATEGY_FAVORED_POSITIONS[strategyKey];

  if (!favored) {
    return STRATEGY_SCORE_NEUTRAL;
  }

  var match =
    favored.filter(function (f) {
      return f.pos === pos;
    })[0];

  return match
    ? match.share
    : 0;
}

function scorePlayer(player, decisionState) {
  var posInfo =
    decisionState.positionalInflation[player.pos];

  var posInflation =
    posInfo
      ? posInfo.inflation
      : decisionState.globalInflation;

  var valueScore =
    computeValueScore(
      player,
      decisionState
    );

  var needScore =
    computeNeedScore(
      player.pos,
      decisionState.userRoster
    );

  var inflationScore =
    clamp01(
      INFLATION_SCORE_NEUTRAL -
      posInflation
    );

  var strategyScore =
    computeStrategyScore(
      player.pos,
      decisionState.strategyKey
    );

  var budgetScore =
    decisionState.maxAffordable > 0
      ? clamp01(
          1 -
          (
            player.targetPrice /
            decisionState.maxAffordable
          )
        )
      : 0;

  var finalScore =
    (valueScore * WEIGHT_VALUE) +
    (needScore * WEIGHT_NEED) +
    (inflationScore * WEIGHT_INFLATION) +
    (strategyScore * WEIGHT_STRATEGY) +
    (budgetScore * WEIGHT_BUDGET);

  return {
    valueScore: valueScore,
    needScore: needScore,
    inflationScore: inflationScore,
    strategyScore: strategyScore,
    budgetScore: budgetScore,
    finalScore: finalScore,

    positionalInflationUsed: posInflation,

    positionalInflationSample:
      posInfo
        ? posInfo.sampleSize
        : 0,

    positionalInflationFallback:
      posInfo
        ? posInfo.usedFallback
        : true
  };
}

function computeMaxPriceForPlayer(player, decisionState) {
  var posInfo =
    decisionState.positionalInflation[player.pos];

  var posInflation =
    posInfo
      ? posInfo.inflation
      : decisionState.globalInflation;

  var inflationAdjusted =
    Math.round(
      player.targetPrice *
      (1 + posInflation)
    );

  return Math.max(
    1,
    Math.min(
      decisionState.maxAffordable,
      inflationAdjusted
    )
  );
}

function classifyAction(finalScore) {
  if (finalScore >= THRESHOLD_TARGET) {
    return 'TARGET';
  }

  if (finalScore >= THRESHOLD_WATCH) {
    return 'WATCH';
  }

  return 'PASS';
}

// ─── REASON / RISK CODES ─────────────────────────────────

function buildReasonCodes(pos, scores) {
  var codes = [];

  if (scores.needScore >= NEED_SCORE_DIRECT) {
    codes.push(pos + ' need');
  } else if (scores.needScore >= NEED_SCORE_FLEX) {
    codes.push(pos + ' flex need');
  }

  if (scores.valueScore >= 0.7) {
    codes.push('target value');
  }

  if (scores.inflationScore >= 0.7) {
    codes.push(pos + ' inflation favorable');
  } else if (scores.inflationScore <= 0.3) {
    codes.push(pos + ' inflation elevated');
  }

  if (scores.strategyScore >= 0.7) {
    codes.push('strategy fit');
  }

  if (scores.budgetScore >= 0.7) {
    codes.push('budget safe');
  }

  return codes;
}

function buildRiskCodes(pos, scores, decisionState) {
  var codes = [];

  if (scores.positionalInflationFallback) {
    codes.push(
      pos +
      '_INFLATION_SAMPLE_THIN_USING_GLOBAL'
    );
  }

  if (scores.budgetScore < 0.3) {
    codes.push('BUDGET_TIGHT_AFTER_PICK');
  }

  var samePosRemainingCount =
    decisionState.remaining.filter(function (p) {
      return p.pos === pos;
    }).length;

  if (samePosRemainingCount <= 2) {
    codes.push(pos + '_DEPTH_THIN');
  }

  return codes;
}

// ─── MULTI-RECOMMENDATION SELECTION ──────────────────────

function computeValueRoleScore(diag) {
  return (
    (diag.valueScore *
      VALUE_ROLE_WEIGHT_VALUE) +

    (diag.budgetScore *
      VALUE_ROLE_WEIGHT_BUDGET) +

    (diag.inflationScore *
      VALUE_ROLE_WEIGHT_INFLATION)
  );
}

function buildRationale(
  role,
  diag,
  decisionState,
  alreadySelected
) {
  var parts = [];

  if (role === 'PRIMARY') {
    if (
      diag.needScore >=
      NEED_SCORE_DIRECT
    ) {
      parts.push(
        diag.pos +
        ' fills a starting need'
      );
    } else if (
      diag.needScore >=
      NEED_SCORE_FLEX
    ) {
      parts.push(
        diag.pos +
        ' fills your FLEX need'
      );
    }

    if (diag.valueScore >= 0.7) {
      parts.push(
        'best remaining value at the position'
      );
    }

    if (diag.strategyScore >= 0.7) {
      parts.push(
        'fits your draft strategy'
      );
    }

    if (!parts.length) {
      parts.push(
        'highest overall score among viable targets'
      );
    }
  }

  else if (role === 'ALTERNATIVE') {
    var primary = alreadySelected[0];

    if (
      primary &&
      diag.pos !== primary.pos
    ) {
      parts.push(
        'a different positional path than ' +
        primary.player
      );
    } else if (primary) {
      parts.push(
        diag.pos +
        ' scarcity currently favors staying concentrated at the position'
      );
    }

    if (
      primary &&
      (
        primary.finalScore -
        diag.finalScore
      ) <=
      ALTERNATIVE_TARGET_CLOSE_SCORE_MARGIN
    ) {
      parts.push(
        'scores close enough to ' +
        primary.player +
        ' to be a legitimate co-favorite, not just a fallback'
      );
    }

    if (!parts.length) {
      parts.push(
        'next-strongest viable target'
      );
    }
  }

  else if (role === 'VALUE') {
    parts.push(
      'strongest value-for-price among remaining options'
    );

    if (diag.budgetScore >= 0.6) {
      parts.push(
        'preserves budget flexibility for remaining needs'
      );
    }

    if (
      diag.positionalInflationFallback === false &&
      diag.inflationScore > 0.5
    ) {
      parts.push(
        diag.pos +
        ' market is running cool right now — room below expected cost'
      );
    }
  }

  else if (role === 'MORE') {
    parts.push(
      'additional viable target, ranked below Primary/Alternative/Value'
    );
  }

  var scoringLabel =
    SCORING_FORMAT_LABELS[
      decisionState.scoringFormat
    ];

  if (
    scoringLabel &&
    (
      diag.pos === 'WR' ||
      diag.pos === 'RB' ||
      diag.pos === 'TE'
    )
  ) {
    parts.push(scoringLabel);
  }

  return parts.join(' — ');
}

// ─── AUCTION SAGE ─────────────────────────────────────────

var SAGE_ACTION_TAKE_NOW =
  'TAKE_NOW';

var SAGE_ACTION_CONSIDER_NOW =
  'CONSIDER_NOW';

var SAGE_ACTION_FLEXIBLE =
  'FLEXIBLE';

var SAGE_ACTION_CAUTION =
  'CAUTION';

var SAGE_ACTION_NEEDS_MORE_EVIDENCE =
  'NEEDS_MORE_EVIDENCE';

var SAGE_ACTION_LABELS = {
  TAKE_NOW: 'Take Now',
  CONSIDER_NOW: 'Consider Now',
  FLEXIBLE: 'Flexible',
  CAUTION: 'Caution',
  NEEDS_MORE_EVIDENCE: 'Needs More Evidence'
};

function hasRiskEvidence(diag) {
  return (
    Array.isArray(diag.riskCodes) &&
    diag.riskCodes.length > 0
  );
}

function hasPositiveEvidence(diag) {
  return (
    Array.isArray(diag.reasonCodes) &&
    diag.reasonCodes.length > 0
  );
}

function deriveSageAction(diag) {
  var risky =
    hasRiskEvidence(diag);

  if (diag.action === 'TARGET') {
    return risky
      ? SAGE_ACTION_CONSIDER_NOW
      : SAGE_ACTION_TAKE_NOW;
  }

  if (diag.action === 'WATCH') {
    return risky
      ? SAGE_ACTION_CAUTION
      : SAGE_ACTION_FLEXIBLE;
  }

  return hasPositiveEvidence(diag)
    ? SAGE_ACTION_CAUTION
    : SAGE_ACTION_NEEDS_MORE_EVIDENCE;
}

function buildSageExplanation(
  sageAction,
  diag,
  decisionState
) {
  var depthRisk =
    (diag.riskCodes || []).some(
      function (c) {
        return (
          c.indexOf(
            '_DEPTH_THIN'
          ) !== -1
        );
      }
    );

  var budgetRisk =
    (diag.riskCodes || []).indexOf(
      'BUDGET_TIGHT_AFTER_PICK'
    ) !== -1;

  var weakValue =
    diag.valueScore <= 0.3;

  var strongValue =
    diag.valueScore >= 0.7;

  var parts = [];

  if (
    diag.needScore >=
    NEED_SCORE_DIRECT
  ) {
    parts.push(
      diag.pos +
      ' fills an open starting need'
    );
  }

  else if (
    diag.needScore >=
    NEED_SCORE_FLEX
  ) {
    parts.push(
      diag.pos +
      ' fills your FLEX need'
    );
  }

  else if (
    diag.needScore <=
    NEED_SCORE_BENCH
  ) {
    parts.push(
      'your ' +
      diag.pos +
      ' need is already covered'
    );
  }

  if (
    depthRisk &&
    weakValue
  ) {
    parts.push(
      'remaining depth at ' +
      diag.pos +
      ' is thin, but the price/value trade-off here does not clearly justify paying up for it'
    );
  }

  else {
    if (strongValue) {
      parts.push(
        'value at this price is strong relative to the field'
      );
    }

    else if (weakValue) {
      parts.push(
        'value at this price is weak relative to the field'
      );
    }

    if (depthRisk) {
      parts.push(
        'remaining depth at ' +
        diag.pos +
        ' is thin, raising the cost of waiting'
      );
    }
  }

  if (
    diag.positionalInflationFallback ===
    false
  ) {
    if (
      diag.inflationScore >= 0.65
    ) {
      parts.push(
        diag.pos +
        ' is running below expected cost right now'
      );
    }

    else if (
      diag.inflationScore <= 0.35
    ) {
      parts.push(
        diag.pos +
        ' is running hot, above expected cost'
      );
    }
  }

  if (budgetRisk) {
    parts.push(
      'committing this much would leave your remaining budget tight for other open slots'
    );
  }

  else if (
    diag.budgetScore >= 0.7
  ) {
    parts.push(
      'this price leaves plenty of budget flexibility for remaining needs'
    );
  }

  var evidenceSentence =
    parts.length
      ? (
          parts.join('; ') +
          '.'
        )
      : '';

  var maxBidClause;

  if (
    sageAction ===
    SAGE_ACTION_TAKE_NOW
  ) {
    maxBidClause =
      "Don't chase the bidding beyond $" +
      diag.maxPrice +
      '.';
  }

  else if (
    sageAction ===
    SAGE_ACTION_CONSIDER_NOW
  ) {
    maxBidClause =
      'Worth pursuing carefully up to $' +
      diag.maxPrice +
      ', not beyond.';
  }

  else if (
    sageAction ===
    SAGE_ACTION_FLEXIBLE
  ) {
    maxBidClause =
      'If the price stays at or below $' +
      diag.maxPrice +
      ", it's a reasonable add — no need to force it.";
  }

  else if (
    sageAction ===
    SAGE_ACTION_CAUTION
  ) {
    maxBidClause =
      'Only worth it if the price falls well under the $' +
      diag.maxPrice +
      ' ceiling.';
  }

  else {
    maxBidClause =
      '$' +
      diag.maxPrice +
      ' would be the ceiling if you do pursue this one.';
  }

  return (
    (
      evidenceSentence
        ? evidenceSentence + ' '
        : ''
    ) +
    maxBidClause
  );
}

function buildRecommendationEntry(
  role,
  diag,
  decisionState,
  alreadySelected
) {
  var sageAction =
    deriveSageAction(diag);

  return {
    role: role,

    player: diag.player,
    pos: diag.pos,

    maxPrice: diag.maxPrice,

    decisionScore:
      Math.round(
        diag.finalScore * 100
      ),

    finalScore: diag.finalScore,

    action: diag.action,

    valueScore:
      diag.valueScore,

    needScore:
      diag.needScore,

    inflationScore:
      diag.inflationScore,

    strategyScore:
      diag.strategyScore,

    budgetScore:
      diag.budgetScore,

    reasonCodes:
      diag.reasonCodes,

    riskCodes:
      diag.riskCodes,

    scoringFormat:
      decisionState.scoringFormat,

    rationale:
      buildRationale(
        role,
        diag,
        decisionState,
        alreadySelected
      ),

    sageAction:
      sageAction,

    sageActionLabel:
      SAGE_ACTION_LABELS[
        sageAction
      ],

    sageExplanation:
      buildSageExplanation(
        sageAction,
        diag,
        decisionState
      )
  };
}

// ─── SHOW MORE TARGETS PORTFOLIO SELECTION ────────────────
//
// This is the Sep 6 2026 Auction SAGE fix.
//
// Previously Show More simply returned the next five viable players
// by finalScore. That allowed a recommendation portfolio such as:
//
// Primary: WR
// Alternative: TE
// Value: QB
// More: WR / WR / WR / WR / WR
//
// even when competitive RB alternatives were available.
//
// This function does NOT alter any player's score.
//
// It does NOT require an RB.
//
// It does NOT enforce a fixed positional quota.
//
// It does NOT change Primary, Alternative or Value Target.
//
// It treats the entire recommendation set as a portfolio. When an
// unrepresented position has a candidate whose existing finalScore is
// at least 90% of the best remaining candidate, SAGE prefers that
// alternative before adding another redundant position.
//
// If no such competitive alternative exists, the original highest
// finalScore candidate wins. Genuine positional dominance therefore
// remains possible.

function buildMoreTargets(
  viable,
  alreadySelectedDiagObjects,
  decisionState
) {
  var remaining =
    viable.filter(function (d) {
      return (
        alreadySelectedDiagObjects.indexOf(d) ===
        -1
      );
    });

  var chosen = [];
  var representedPositions = {};

  alreadySelectedDiagObjects.forEach(
    function (d) {
      representedPositions[d.pos] =
        true;
    }
  );

  while (
    remaining.length &&
    chosen.length <
      MORE_TARGETS_COUNT
  ) {
    // `remaining` is already in the engine's normal
    // finalScore-descending order.
    var bestRemaining =
      remaining[0];

    var diversityFloor =
      bestRemaining.finalScore *
      MORE_TARGETS_DIVERSITY_RELATIVE_MARGIN;

    // Find the highest-ranked candidate whose position
    // is not already represented in the portfolio and
    // whose EXISTING score is genuinely competitive.
    var diverseCandidate =
      remaining.filter(
        function (d) {
          return (
            !representedPositions[d.pos] &&
            d.finalScore >=
              diversityFloor
          );
        }
      )[0];

    // Diversity is a preference, not a requirement.
    // If another position isn't competitive enough,
    // retain the engine's original best candidate.
    var candidate =
      diverseCandidate ||
      bestRemaining;

    chosen.push(candidate);

    representedPositions[
      candidate.pos
    ] = true;

    remaining =
      remaining.filter(
        function (d) {
          return d !== candidate;
        }
      );
  }

  return chosen.map(
    function (d) {
      return buildRecommendationEntry(
        'MORE',
        d,
        decisionState,
        alreadySelectedDiagObjects
      );
    }
  );
}

// ─── SELECT RECOMMENDATION SET ────────────────────────────

function selectRecommendationSet(
  sortedDiagnostics,
  decisionState
) {
  var viable =
    sortedDiagnostics.filter(
      function (d) {
        return !d.vetoed;
      }
    );

  // K/DEF remain fully scored for diagnostics, but
  // stay out of recommendations until core offensive
  // starting slots are filled.
  if (
    hasOpenCoreOffensiveStarterSlot(
      decisionState.userRoster
    )
  ) {
    viable =
      viable.filter(
        function (d) {
          return (
            LATE_DRAFT_ONLY_POSITIONS.indexOf(
              d.pos
            ) === -1
          );
        }
      );
  }

  var selected = [];

  if (!viable.length) {
    return {
      recommendations: selected,
      moreTargets: []
    };
  }

  // PRIMARY
  // Unchanged: highest existing finalScore.
  var primary =
    viable[0];

  selected.push(
    buildRecommendationEntry(
      'PRIMARY',
      primary,
      decisionState,
      selected
    )
  );

  if (viable.length === 1) {
    return {
      recommendations: selected,
      moreTargets: []
    };
  }

  var remainingAfterPrimary =
    viable.slice(1);

  // ALTERNATIVE
  // Prefer another position when close enough.
  var altCandidate =
    remainingAfterPrimary.filter(
      function (d) {
        return (
          d.pos !== primary.pos &&
          (
            primary.finalScore -
            d.finalScore
          ) <=
          ALTERNATIVE_TARGET_CLOSE_SCORE_MARGIN
        );
      }
    )[0];

  if (!altCandidate) {
    altCandidate =
      remainingAfterPrimary[0];
  }

  selected.push(
    buildRecommendationEntry(
      'ALTERNATIVE',
      altCandidate,
      decisionState,
      selected
    )
  );

  if (
    remainingAfterPrimary.length ===
    1
  ) {
    return {
      recommendations: selected,
      moreTargets: []
    };
  }

  // VALUE
  // Existing value-role logic retained.
  var remainingForValue =
    remainingAfterPrimary.filter(
      function (d) {
        return d !== altCandidate;
      }
    );

  if (!remainingForValue.length) {
    return {
      recommendations: selected,
      moreTargets: []
    };
  }

  var byValueRoleScore =
    remainingForValue
      .slice()
      .sort(
        function (a, b) {
          return (
            computeValueRoleScore(b) -
            computeValueRoleScore(a)
          );
        }
      );

  var bestValueRoleScore =
    computeValueRoleScore(
      byValueRoleScore[0]
    );

  var diverseValueCandidate =
    byValueRoleScore.filter(
      function (d) {
        return (
          d.pos !== primary.pos &&
          d.pos !== altCandidate.pos &&
          computeValueRoleScore(d) >=
            (
              bestValueRoleScore *
              VALUE_TARGET_DIVERSITY_RELATIVE_MARGIN
            )
        );
      }
    )[0];

  var valueCandidate =
    diverseValueCandidate ||
    byValueRoleScore[0];

  selected.push(
    buildRecommendationEntry(
      'VALUE',
      valueCandidate,
      decisionState,
      selected
    )
  );

  // SHOW MORE
  // New portfolio-aware selection.
  var moreTargets =
    buildMoreTargets(
      viable,
      [
        primary,
        altCandidate,
        valueCandidate
      ],
      decisionState
    );

  return {
    recommendations: selected,
    moreTargets: moreTargets
  };
}

// ─── MAIN ORCHESTRATOR ────────────────────────────────────

function runDecisionEngine(
  state,
  allPlayers
) {
  var decisionState =
    buildDecisionState(
      state,
      allPlayers || []
    );

  if (!decisionState.userTeam) {
    return {
      status:
        'NO_USER_TEAM_SELECTED',

      recommendations: [],
      moreTargets: [],
      diagnostics: [],
      unscored: [],
      unscoredCount: 0
    };
  }

  if (
    decisionState.totalOpenSlots <= 0
  ) {
    return {
      status: 'ROSTER_FULL',

      recommendations: [],
      moreTargets: [],

      diagnostics: [],

      unscored:
        decisionState.unscored,

      unscoredCount:
        decisionState.unscored.length
    };
  }

  var diagnostics =
    decisionState.remaining.map(
      function (player) {
        var positionRank =
          player.pos === 'DEF'
            ? decisionState
                .defRankLookup[
                  player.name.toLowerCase()
                ]
            : undefined;

        var hardRuleResult =
          applyHardRules(
            player,
            decisionState
          );

        if (hardRuleResult.vetoed) {
          return {
            player:
              player.name,

            pos:
              player.pos,

            targetPrice:
              player.targetPrice,

            vetoed:
              true,

            vetoCode:
              hardRuleResult.code,

            action:
              'PASS',

            source:
              'hard_rule',

            finalScore:
              0,

            positionRank:
              positionRank
          };
        }

        var scores =
          scorePlayer(
            player,
            decisionState
          );

        var action =
          classifyAction(
            scores.finalScore
          );

        var maxPrice =
          computeMaxPriceForPlayer(
            player,
            decisionState
          );

        return {
          player:
            player.name,

          pos:
            player.pos,

          targetPrice:
            player.targetPrice,

          vetoed:
            false,

          action:
            action,

          source:
            'deterministic',

          maxPrice:
            maxPrice,

          valueScore:
            scores.valueScore,

          needScore:
            scores.needScore,

          inflationScore:
            scores.inflationScore,

          strategyScore:
            scores.strategyScore,

          budgetScore:
            scores.budgetScore,

          finalScore:
            scores.finalScore,

          positionRank:
            positionRank,

          positionalInflationUsed:
            scores.positionalInflationUsed,

          positionalInflationSample:
            scores.positionalInflationSample,

          positionalInflationFallback:
            scores.positionalInflationFallback,

          reasonCodes:
            buildReasonCodes(
              player.pos,
              scores
            ),

          riskCodes:
            buildRiskCodes(
              player.pos,
              scores,
              decisionState
            )
        };
      }
    );

  // Primary ordering remains finalScore descending.
  // DEF ADP rank is only a tie-break when two DEF
  // candidates have identical finalScore.
  diagnostics.sort(
    function (a, b) {
      var scoreDiff =
        b.finalScore -
        a.finalScore;

      if (scoreDiff !== 0) {
        return scoreDiff;
      }

      if (
        a.pos === 'DEF' &&
        b.pos === 'DEF' &&
        typeof a.positionRank ===
          'number' &&
        typeof b.positionRank ===
          'number'
      ) {
        return (
          a.positionRank -
          b.positionRank
        );
      }

      return 0;
    }
  );

  var recommendationResult =
    selectRecommendationSet(
      diagnostics,
      decisionState
    );

  var recommendations =
    recommendationResult
      .recommendations;

  var moreTargets =
    recommendationResult
      .moreTargets;

  return {
    status:
      recommendations.length
        ? 'RECOMMENDATIONS'
        : 'NO_VIABLE_PLAYERS',

    recommendations:
      recommendations,

    moreTargets:
      moreTargets,

    diagnostics:
      diagnostics,

    unscored:
      decisionState.unscored,

    unscoredCount:
      decisionState.unscored.length,

    decisionStateSummary: {
      userTeam:
        decisionState.userTeam,

      userBudgetRemaining:
        decisionState
          .userBudgetRemaining,

      totalOpenSlots:
        decisionState
          .totalOpenSlots,

      maxAffordable:
        decisionState
          .maxAffordable,

      globalInflation:
        decisionState
          .globalInflation,

      positionalInflation:
        decisionState
          .positionalInflation,

      scoringFormat:
        decisionState
          .scoringFormat
    }
  };
}

// ─── EXPORTS ──────────────────────────────────────────────

if (
  typeof module !== 'undefined' &&
  module.exports
) {
  module.exports = {
    runDecisionEngine:
      runDecisionEngine,

    buildDecisionState:
      buildDecisionState,

    scorePlayer:
      scorePlayer,

    applyHardRules:
      applyHardRules,

    classifyAction:
      classifyAction,

    clamp01:
      clamp01,

    selectRecommendationSet:
      selectRecommendationSet,

    hasOpenCoreOffensiveStarterSlot:
      hasOpenCoreOffensiveStarterSlot,

    buildRationale:
      buildRationale,

    computeValueRoleScore:
      computeValueRoleScore,

    ALTERNATIVE_TARGET_CLOSE_SCORE_MARGIN:
      ALTERNATIVE_TARGET_CLOSE_SCORE_MARGIN,

    INFLATION_SCORE_NEUTRAL:
      INFLATION_SCORE_NEUTRAL,

    THRESHOLD_TARGET:
      THRESHOLD_TARGET,

    THRESHOLD_WATCH:
      THRESHOLD_WATCH,

    MORE_TARGETS_COUNT:
      MORE_TARGETS_COUNT,

    MORE_TARGETS_DIVERSITY_RELATIVE_MARGIN:
      MORE_TARGETS_DIVERSITY_RELATIVE_MARGIN,

    buildMoreTargets:
      buildMoreTargets,

    deriveSageAction:
      deriveSageAction,

    buildSageExplanation:
      buildSageExplanation,

    buildRecommendationEntry:
      buildRecommendationEntry,

    SAGE_ACTION_TAKE_NOW:
      SAGE_ACTION_TAKE_NOW,

    SAGE_ACTION_CONSIDER_NOW:
      SAGE_ACTION_CONSIDER_NOW,

    SAGE_ACTION_FLEXIBLE:
      SAGE_ACTION_FLEXIBLE,

    SAGE_ACTION_CAUTION:
      SAGE_ACTION_CAUTION,

    SAGE_ACTION_NEEDS_MORE_EVIDENCE:
      SAGE_ACTION_NEEDS_MORE_EVIDENCE,

    SAGE_ACTION_LABELS:
      SAGE_ACTION_LABELS
  };
}
