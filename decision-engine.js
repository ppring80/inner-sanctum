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
var THRESHOLD_TARGET = 0.70;   // finalScore >= this -> TARGET
var THRESHOLD_WATCH  = 0.45;   // finalScore >= this (and < TARGET) -> WATCH
                                // below THRESHOLD_WATCH -> PASS

// Hard-rule budget math: dollars reserved per OTHER open roster slot
// (the slot the evaluated player would fill is not reserved for).
var MIN_SLOT_RESERVE_DOLLARS = 1;

// Positional inflation trust threshold — below this many drafted-and-
// projected picks at a position, fall back to global inflation rather
// than trusting a thin/noisy positional sample (Pat's call, Aug 12 2026:
// "don't trust positional inflation after a single sale").
var MIN_POSITIONAL_SAMPLE_FOR_INFLATION = 2;

// inflationScore baseline — the score awarded at exactly 0% positional
// inflation. Kept at the midpoint (0.5) so "normal" market pricing is
// neutral rather than treated as a bargain; see scorePlayer() for the
// full formula. (Corrected Aug 12 2026 — see comment at call site.)
var INFLATION_SCORE_NEUTRAL = 0.5;

// needScore tiers — how directly a pick fills an open roster need
var NEED_SCORE_DIRECT = 1.0;   // fills this position's own roster slot
var NEED_SCORE_FLEX   = 0.6;   // only FLEX capacity remains for this position
var NEED_SCORE_BENCH  = 0.3;   // only BENCH capacity remains
var NEED_SCORE_NONE   = 0.0;   // no open slot at all (would be hard-rule vetoed)

// strategyScore neutral value for a 'custom' strategy — no positional
// preference is invented for custom plans (Pat's call, Aug 12 2026:
// pricedSlots already reflects the user's custom allocation, so
// valueScore already carries that signal; strategyScore stays neutral).
var STRATEGY_SCORE_NEUTRAL = 0.5;

// ─── MULTI-RECOMMENDATION ROLE-SELECTION CONSTANTS (Aug 13 2026) ───
// These govern which candidate fills the Alternative/Value Target role.
// They are a SELECTION layer on top of the existing per-player factor
// scores — they do not change WEIGHT_VALUE/WEIGHT_NEED/WEIGHT_INFLATION/
// WEIGHT_STRATEGY/WEIGHT_BUDGET or finalScore itself, and Primary Target
// selection is unchanged (still simply the #1 finalScore). Added per
// Pat's explicit instruction not to tune the existing scoring weights.

// How close (in finalScore) a different-position candidate must be to
// Primary Target to count as a genuine close alternative. Within this
// margin, Alternative Target prefers positional diversity from Primary;
// outside it, falls back to the next-best candidate overall — which is
// what allows 3 same-position recommendations when scarcity is real
// (see Pat's brief: "if the three strongest actionable targets are RBs,
// returning three RBs may be correct").
var ALTERNATIVE_TARGET_CLOSE_SCORE_MARGIN = 0.15;

// Value Target is chosen by this composite instead of finalScore rank —
// re-weighting the SAME existing factor scores (valueScore, budgetScore,
// inflationScore) toward value/affordability rather than need/strategy.
// No new inputs are introduced.
var VALUE_ROLE_WEIGHT_VALUE = 0.5;
var VALUE_ROLE_WEIGHT_BUDGET = 0.3;
var VALUE_ROLE_WEIGHT_INFLATION = 0.2;

// Plain-language, factual-only scoring-format note for rationale text.
// Deliberately does not claim a specific causal effect on ranking (the
// price sheet already bakes format into price — see buildDecisionState) —
// just states which format the numbers reflect.
var SCORING_FORMAT_LABELS = {
  standard: 'Values reflect Standard scoring.',
  half: 'Values reflect Half PPR scoring.',
  ppr: 'Values reflect PPR scoring.'
};

// Literal draftable positions (matches POS_ORDER in auction.html)
var POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

// Positions eligible to fill a FLEX roster slot (standard convention;
// not configurable in Phase 1). Named DECISION_-prefixed specifically
// because auction.html's own inline script already declares an
// unrelated `const FLEX_ELIGIBLE_POSITIONS` for its price-sheet
// generator (dollarsForSlots()) — a plain `var FLEX_ELIGIBLE_POSITIONS`
// here collided with that const and threw a page-breaking SyntaxError,
// caught by the smoke test on the first real DOM-level run (Aug 12
// 2026). Do not rename back without also checking for collisions
// against auction.html's existing top-level identifiers.
var DECISION_FLEX_ELIGIBLE_POSITIONS = ['RB', 'WR', 'TE'];

// ─── K/DEF RECOMMENDATION-ROLE ELIGIBILITY GATE (Aug 13 2026) ──────
// Selection-layer only -- does not affect scoring or diagnostics. Added
// after a real decision-quality issue: Value Target recommended a
// kicker after only 2 picks, because in a nearly-untouched player pool
// a K's finalScore can legitimately beat real offensive value (thin K
// pool -> high valueScore; whole budget still open -> high budgetScore).
// Core offensive starters -- not bench depth -- are what K/DEF should
// wait on; see hasOpenCoreOffensiveStarterSlot() below.
var CORE_OFFENSIVE_STARTER_POSITIONS = ['QB', 'RB', 'WR', 'TE'];
var LATE_DRAFT_ONLY_POSITIONS = ['K', 'DEF'];

// All roster-slot keys as used in state.roster
var ROSTER_SLOT_KEYS = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BENCH'];

// Strategy -> favored positions, mirroring auction.html's FAVORED_POSITIONS
// but limited to rb/wr/qb/hero only, per Pat's decision (Aug 12 2026):
// do NOT map 'custom' to 'balanced' — custom gets a neutral strategyScore
// instead of an invented preference. Duplicated locally (not imported from
// auction.html) to keep this file self-contained for Phase 1.
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
  (teamNames || []).forEach(function (t) { spent[t] = 0; });
  (draftLog || []).forEach(function (p) {
    if (spent[p.team] === undefined) spent[p.team] = 0;
    spent[p.team] += (p.price || 0);
  });
  var remaining = {};
  Object.keys(spent).forEach(function (t) { remaining[t] = budget - spent[t]; });
  return remaining;
}

// ─── DERIVE: USER ROSTER FILLED / OPEN ────────────────────
// Greedy allocation: direct positional slots fill first, leftover
// RB/WR/TE spill into FLEX, anything left after that spills into BENCH.
// This is a simplification — the draft log only records a pick's
// position, not which literal slot it occupies, so there is no way to
// know for certain whether a given RB actually sits in "RB2" vs. "FLEX"
// vs. "BENCH". Direct-first/flex-next/bench-last is the most standard
// real-draft convention and is what the hard rules and needScore rely
// on for "is there an open slot at this position."
function deriveUserRoster(draftLog, userTeam, rosterTargets) {
  var draftedByPos = {};
  POSITIONS.forEach(function (p) { draftedByPos[p] = 0; });
  (draftLog || []).forEach(function (p) {
    if (p.team !== userTeam) return;
    var pos = normalizePos(p.pos);
    if (draftedByPos[pos] !== undefined) draftedByPos[pos]++;
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
    openDirect[pos] = Math.max(0, (rosterTargets[pos] || 0) - filledDirect[pos]);
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
    // Raw configured targets, kept alongside the derived fields above so
    // hasOpenSlotForPosition() can tell "no K/DEF slot exists in this
    // league" apart from "the K/DEF slot exists but is currently filled"
    // (Aug 14 2026 -- see gate below; openDirect[pos]=0 alone can't make
    // that distinction, since it's also 0 once a real slot is filled).
    rosterTargets: rosterTargets
  };
}

function hasOpenSlotForPosition(pos, userRoster) {
  if (!userRoster) return false;
  pos = normalizePos(pos);
  // Hard positional-legality gate (Aug 14 2026): a league configured with
  // K:0 or DEF:0 has no slot for that position at all, on this team or any
  // team -- bench capacity is roster depth for positions the league
  // actually rosters, not a backdoor into positions it doesn't. Without
  // this, the generic bench-capacity fallback below (by design
  // position-agnostic, for every other position) would make K/DEF
  // "eligible" via bench once core offensive starters fill, regardless of
  // whether either is configured at all -- confirmed live: K/DEF won
  // Primary/Alternative Target outright in that state before this gate.
  // Scoped to K/DEF only, not generalized to QB/RB/WR/TE: those positions
  // are asserted to always carry a real direct target in every roster
  // format this app currently supports (FLEX eligibility itself is
  // hardcoded to RB/WR/TE, not QB, so there's no equivalent "covered some
  // other way" path for them to fall back on the way K/DEF have bench);
  // broadening this gate to all positions was not validated against that
  // assumption and is left out of this narrow fix.
  if ((pos === 'K' || pos === 'DEF') && (userRoster.rosterTargets[pos] || 0) === 0) {
    return false;
  }
  if ((userRoster.openDirect[pos] || 0) > 0) return true;
  if (DECISION_FLEX_ELIGIBLE_POSITIONS.indexOf(pos) !== -1 && userRoster.flexRemainingCapacity > 0) return true;
  if (userRoster.benchRemainingCapacity > 0) return true;
  return false;
}

// True while any CORE offensive starting slot (QB/RB/WR/TE direct, or
// FLEX) is still open. Bench capacity deliberately does NOT count here
// — per Pat's instruction, K/DEF should wait on core starters, not on
// bench depth, which is nearly always open early regardless.
function hasOpenCoreOffensiveStarterSlot(userRoster) {
  if (!userRoster) return true; // unknown roster state -> treat as still-open, fail toward excluding K/DEF
  var anyDirectOpen = CORE_OFFENSIVE_STARTER_POSITIONS.some(function (pos) {
    return (userRoster.openDirect[pos] || 0) > 0;
  });
  return anyDirectOpen || userRoster.flexRemainingCapacity > 0;
}

function computeNeedScore(pos, userRoster) {
  if (!userRoster) return NEED_SCORE_NONE;
  pos = normalizePos(pos);
  if ((userRoster.openDirect[pos] || 0) > 0) return NEED_SCORE_DIRECT;
  if (DECISION_FLEX_ELIGIBLE_POSITIONS.indexOf(pos) !== -1 && userRoster.flexRemainingCapacity > 0) return NEED_SCORE_FLEX;
  if (userRoster.benchRemainingCapacity > 0) return NEED_SCORE_BENCH;
  return NEED_SCORE_NONE;
}

// ─── DERIVE: REMAINING PLAYERS (scored + unscored) ────────
// Players already in the draft log are excluded here — this structurally
// satisfies hard rule #3 ("never recommend a player already drafted"),
// since vetted players never enter the scoring pool at all.
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
    var price = playerPriceLookup ? playerPriceLookup[key] : undefined;
    if (typeof price === 'number') {
      remaining.push({ name: p.name, pos: normalizePos(p.pos), team: p.team, targetPrice: price });
    } else {
      unscored.push({ name: p.name, pos: normalizePos(p.pos), team: p.team, reasonCode: 'UNSCORED_NO_TARGET_PRICE' });
    }
  });

  return { remaining: remaining, unscored: unscored };
}

// ─── DERIVE: INFLATION ─────────────────────────────────────
// Duplicated from updateTrackerStats() in auction.html by design (see
// header comment) — same ratio, kept as an unrounded decimal here
// instead of a rounded display percent since the scoring math needs
// the precision.
function deriveGlobalInflation(draftLog) {
  var withProjection = (draftLog || []).filter(function (p) { return p.projected && p.projected > 0; });
  if (!withProjection.length) return 0;
  var avgRatio = withProjection.reduce(function (a, p) { return a + (p.price / p.projected); }, 0) / withProjection.length;
  return avgRatio - 1;
}

function derivePositionalInflation(draftLog, globalInflation) {
  var byPos = {};
  POSITIONS.forEach(function (pos) {
    var picks = (draftLog || []).filter(function (p) {
      return normalizePos(p.pos) === pos && p.projected && p.projected > 0;
    });
    if (picks.length < MIN_POSITIONAL_SAMPLE_FOR_INFLATION) {
      byPos[pos] = { inflation: globalInflation, sampleSize: picks.length, usedFallback: true };
    } else {
      var avgRatio = picks.reduce(function (a, p) { return a + (p.price / p.projected); }, 0) / picks.length;
      byPos[pos] = { inflation: avgRatio - 1, sampleSize: picks.length, usedFallback: false };
    }
  });
  return byPos;
}

// ─── BUILD DECISION STATE ──────────────────────────────────
function buildDecisionState(state, allPlayers) {
  var userTeam = state.userTeam || null;
  var draftLog = state.draftLog || [];
  var teamNames = state.teamNames || [];
  var budget = state.budget || 0;
  var rosterTargets = state.roster || {};
  var strategyKey = state.strategy || null;
  // Threaded through for rationale/diagnostics observability only (Pat's
  // instruction, Aug 13 2026). The underlying valuation math is NOT
  // rebuilt here: state.scoring already feeds fetchLiveAdpByPosition()
  // when the Target Price Sheet is generated (auction.html generateTPS()),
  // so playerPriceLookup — and therefore valueScore, which ranks off it —
  // already reflects the league's scoring format by construction. This
  // field exists so rationale text and diagnostics can reference which
  // format is active; it deliberately does not introduce a second,
  // parallel scoring-format adjustment on top of the price sheet's.
  var scoringFormat = state.scoring || null;
  var playerPriceLookup = state.playerPriceLookup || {};
  // DEF-only ADP rank lookup, used ONLY as a secondary sort tie-break in
  // runDecisionEngine() when two DEF candidates' finalScore is identical --
  // never an input to any of the 5 weighted scoring factors. See
  // buildDefRankLookup() in auction.html for how this is populated.
  var defRankLookup = state.defRankLookup || {};

  var teamBudgetsRemaining = deriveTeamBudgets(draftLog, budget, teamNames);
  var userRoster = userTeam ? deriveUserRoster(draftLog, userTeam, rosterTargets) : null;
  var derivedPlayers = derivePlayersRemaining(allPlayers, draftLog, playerPriceLookup);
  var globalInflation = deriveGlobalInflation(draftLog);
  var positionalInflation = derivePositionalInflation(draftLog, globalInflation);

  var userDraftedCount = draftLog.filter(function (p) { return p.team === userTeam; }).length;
  var totalRosterSlots = ROSTER_SLOT_KEYS.reduce(function (sum, k) { return sum + (rosterTargets[k] || 0); }, 0);
  var totalOpenSlots = Math.max(0, totalRosterSlots - userDraftedCount);

  var userBudgetRemaining = userTeam
    ? (teamBudgetsRemaining[userTeam] != null ? teamBudgetsRemaining[userTeam] : budget)
    : null;

  // Hard rule #1: budgetRemaining - ((openSlots - 1) * $1). The slot this
  // pick would fill is not reserved for; every OTHER open slot needs $1.
  var maxAffordable = 0;
  if (userTeam && totalOpenSlots > 0) {
    maxAffordable = Math.max(0, userBudgetRemaining - ((totalOpenSlots - 1) * MIN_SLOT_RESERVE_DOLLARS));
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

// ─── HARD RULES ─────────────────────────────────────────────
function applyHardRules(player, decisionState) {
  if (player.targetPrice > decisionState.maxAffordable) {
    return { vetoed: true, code: 'HARD_RULE_BUDGET_CAP' };
  }
  if (!hasOpenSlotForPosition(player.pos, decisionState.userRoster)) {
    return { vetoed: true, code: 'HARD_RULE_NO_OPEN_SLOT' };
  }
  return { vetoed: false };
}

// ─── SCORING FACTORS ────────────────────────────────────────
// valueScore: this player's price-sheet target price, ranked against the
// remaining pool at their OWN position (highest remaining target price
// at a position scores highest). The price sheet is itself derived from
// ADP, so this is a "best remaining player at this position, by the
// model's own read of the board" signal, not an independent quality
// metric — there's no separate projection data to compare price against
// in Phase 1. Documented here for tuning review.
//
// Aug 13 2026 fix: the comparison pool excludes same-position candidates
// that are already unaffordable for this team (targetPrice > maxAffordable).
// Without this, a same-position player this team could never actually buy
// still set the top of the price range, silently depressing every genuinely
// affordable candidate's valueScore toward 0 — meaning the score answered
// "how does this compare to every remaining player at the position" rather
// than "how does this compare to the players I could realistically acquire."
// Uses the same affordability condition applyHardRules() checks, applied
// directly here rather than calling applyHardRules() itself — that function
// also vetoes on the separate no-open-slot condition, which would broaden
// this filter beyond affordability alone. No weights, need/inflation/
// strategy/budget scoring, maxPrice, hard-rule definitions, or roster logic
// are touched by this change.
function computeValueScore(player, decisionState) {
  var samePos = decisionState.remaining.filter(function (p) {
    return p.pos === player.pos && p.targetPrice <= decisionState.maxAffordable;
  });
  var prices = samePos.map(function (p) { return p.targetPrice; });
  var maxP = Math.max.apply(null, prices);
  var minP = Math.min.apply(null, prices);
  if (maxP === minP) return 1;
  return (player.targetPrice - minP) / (maxP - minP);
}

// strategyScore: alignment with the user's chosen draft strategy.
// 'custom' (and any unrecognized strategy key) gets the neutral score —
// no invented positional preference (see STRATEGY_SCORE_NEUTRAL above).
function computeStrategyScore(pos, strategyKey) {
  if (!strategyKey || strategyKey === 'custom') return STRATEGY_SCORE_NEUTRAL;
  var favored = STRATEGY_FAVORED_POSITIONS[strategyKey];
  if (!favored) return STRATEGY_SCORE_NEUTRAL;
  var match = favored.filter(function (f) { return f.pos === pos; })[0];
  return match ? match.share : 0;
}

function scorePlayer(player, decisionState) {
  var posInfo = decisionState.positionalInflation[player.pos];
  var posInflation = posInfo ? posInfo.inflation : decisionState.globalInflation;

  var valueScore = computeValueScore(player, decisionState);
  var needScore = computeNeedScore(player.pos, decisionState.userRoster);
  // inflationScore: 0% inflation is NEUTRAL (0.5), not a perfect score — a
  // position trading exactly at target price isn't a special opportunity,
  // it's just normal. Score rises above 0.5 only when the position is
  // running BELOW target (a real bargain) and falls below 0.5 when it's
  // running HOT (an overheated market), symmetric around zero. Corrected
  // per Pat's review, Aug 12 2026 — the prior version treated "no
  // inflation" the same as "screaming deal" (both scored 1.0) and only
  // started penalizing once inflation turned positive, which understated
  // how undesirable an already-elevated position is.
  var inflationScore = clamp01(INFLATION_SCORE_NEUTRAL - posInflation);
  var strategyScore = computeStrategyScore(player.pos, decisionState.strategyKey);
  var budgetScore = decisionState.maxAffordable > 0
    ? clamp01(1 - (player.targetPrice / decisionState.maxAffordable))
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
    positionalInflationSample: posInfo ? posInfo.sampleSize : 0,
    positionalInflationFallback: posInfo ? posInfo.usedFallback : true
  };
}

function computeMaxPriceForPlayer(player, decisionState) {
  var posInfo = decisionState.positionalInflation[player.pos];
  var posInflation = posInfo ? posInfo.inflation : decisionState.globalInflation;
  var inflationAdjusted = Math.round(player.targetPrice * (1 + posInflation));
  return Math.max(1, Math.min(decisionState.maxAffordable, inflationAdjusted));
}

function classifyAction(finalScore) {
  if (finalScore >= THRESHOLD_TARGET) return 'TARGET';
  if (finalScore >= THRESHOLD_WATCH) return 'WATCH';
  return 'PASS';
}

// ─── REASON / RISK CODES ────────────────────────────────────
function buildReasonCodes(pos, scores) {
  var codes = [];
  if (scores.needScore >= NEED_SCORE_DIRECT) codes.push(pos + ' need');
  else if (scores.needScore >= NEED_SCORE_FLEX) codes.push(pos + ' flex need');
  if (scores.valueScore >= 0.7) codes.push('target value');
  if (scores.inflationScore >= 0.7) codes.push(pos + ' inflation favorable');
  else if (scores.inflationScore <= 0.3) codes.push(pos + ' inflation elevated');
  if (scores.strategyScore >= 0.7) codes.push('strategy fit');
  if (scores.budgetScore >= 0.7) codes.push('budget safe');
  return codes;
}

function buildRiskCodes(pos, scores, decisionState) {
  var codes = [];
  if (scores.positionalInflationFallback) codes.push(pos + '_INFLATION_SAMPLE_THIN_USING_GLOBAL');
  if (scores.budgetScore < 0.3) codes.push('BUDGET_TIGHT_AFTER_PICK');
  var samePosRemainingCount = decisionState.remaining.filter(function (p) { return p.pos === pos; }).length;
  if (samePosRemainingCount <= 2) codes.push(pos + '_DEPTH_THIN');
  return codes;
}

// ─── MULTI-RECOMMENDATION SELECTION (Aug 13 2026) ──────────────
// Extends the existing single-recommendation pipeline: reuses the
// already-scored, already-sorted diagnostics array as-is and adds a
// role-assignment layer on top. Does not alter how any individual
// player was scored.
function computeValueRoleScore(diag) {
  return (diag.valueScore * VALUE_ROLE_WEIGHT_VALUE) +
    (diag.budgetScore * VALUE_ROLE_WEIGHT_BUDGET) +
    (diag.inflationScore * VALUE_ROLE_WEIGHT_INFLATION);
}

function buildRationale(role, diag, decisionState, alreadySelected) {
  var parts = [];

  if (role === 'PRIMARY') {
    if (diag.needScore >= NEED_SCORE_DIRECT) parts.push(diag.pos + ' fills a starting need');
    else if (diag.needScore >= NEED_SCORE_FLEX) parts.push(diag.pos + ' fills your FLEX need');
    if (diag.valueScore >= 0.7) parts.push('best remaining value at the position');
    if (diag.strategyScore >= 0.7) parts.push('fits your draft strategy');
    if (!parts.length) parts.push('highest overall score among viable targets');
  } else if (role === 'ALTERNATIVE') {
    var primary = alreadySelected[0];
    if (primary && diag.pos !== primary.pos) {
      parts.push('a different positional path than ' + primary.player);
    } else if (primary) {
      parts.push(diag.pos + ' scarcity currently favors staying concentrated at the position');
    }
    if (primary && (primary.finalScore - diag.finalScore) <= ALTERNATIVE_TARGET_CLOSE_SCORE_MARGIN) {
      parts.push('scores close enough to ' + primary.player + ' to be a legitimate co-favorite, not just a fallback');
    }
    if (!parts.length) parts.push('next-strongest viable target');
  } else if (role === 'VALUE') {
    parts.push('strongest value-for-price among remaining options');
    if (diag.budgetScore >= 0.6) parts.push('preserves budget flexibility for remaining needs');
    if (diag.positionalInflationFallback === false && diag.inflationScore > 0.5) {
      parts.push(diag.pos + ' market is running cool right now — room below expected cost');
    }
  }

  var scoringLabel = SCORING_FORMAT_LABELS[decisionState.scoringFormat];
  if (scoringLabel && (diag.pos === 'WR' || diag.pos === 'RB' || diag.pos === 'TE')) {
    parts.push(scoringLabel);
  }

  return parts.join(' — ');
}

function buildRecommendationEntry(role, diag, decisionState, alreadySelected) {
  return {
    role: role,
    player: diag.player,
    pos: diag.pos,
    maxPrice: diag.maxPrice,
    decisionScore: Math.round(diag.finalScore * 100),
    finalScore: diag.finalScore,
    action: diag.action,
    valueScore: diag.valueScore,
    needScore: diag.needScore,
    inflationScore: diag.inflationScore,
    strategyScore: diag.strategyScore,
    budgetScore: diag.budgetScore,
    reasonCodes: diag.reasonCodes,
    riskCodes: diag.riskCodes,
    scoringFormat: decisionState.scoringFormat,
    rationale: buildRationale(role, diag, decisionState, alreadySelected)
  };
}

// Selects up to 3 ranked recommendations (Primary/Alternative/Value)
// from an already-scored, already-sorted (desc by finalScore)
// diagnostics array. Returns 0-3 entries depending on how many
// non-vetoed ("viable") candidates exist — never forces a count.
function selectRecommendationSet(sortedDiagnostics, decisionState) {
  var viable = sortedDiagnostics.filter(function (d) { return !d.vetoed; });

  // Role-eligibility gate: K/DEF stay fully scored in `diagnostics`
  // (untouched, built before this function runs) but are excluded from
  // the pool used for Primary/Alternative/Value while core offensive
  // starters remain open. Naturally lifts once those slots fill in.
  if (hasOpenCoreOffensiveStarterSlot(decisionState.userRoster)) {
    viable = viable.filter(function (d) { return LATE_DRAFT_ONLY_POSITIONS.indexOf(d.pos) === -1; });
  }

  var selected = [];
  if (!viable.length) return selected;

  // Primary Target: unchanged from Phase 1 — the single best player by
  // the existing finalScore/weights.
  var primary = viable[0];
  selected.push(buildRecommendationEntry('PRIMARY', primary, decisionState, selected));
  if (viable.length === 1) return selected;

  var remainingAfterPrimary = viable.slice(1);

  // Alternative Target: prefer a different-position candidate that's
  // still genuinely competitive (within the close-score margin);
  // otherwise fall back to the next-best candidate overall.
  var altCandidate = remainingAfterPrimary.filter(function (d) {
    return d.pos !== primary.pos && (primary.finalScore - d.finalScore) <= ALTERNATIVE_TARGET_CLOSE_SCORE_MARGIN;
  })[0];
  if (!altCandidate) altCandidate = remainingAfterPrimary[0];
  selected.push(buildRecommendationEntry('ALTERNATIVE', altCandidate, decisionState, selected));
  if (remainingAfterPrimary.length === 1) return selected;

  // Value Target: best remaining candidate (excluding whoever was
  // already selected) by a value/budget-weighted composite, not by
  // finalScore rank — this is what keeps it from being "just #3."
  var remainingForValue = remainingAfterPrimary.filter(function (d) { return d !== altCandidate; });
  if (!remainingForValue.length) return selected;
  var valueCandidate = remainingForValue.slice().sort(function (a, b) {
    return computeValueRoleScore(b) - computeValueRoleScore(a);
  })[0];
  selected.push(buildRecommendationEntry('VALUE', valueCandidate, decisionState, selected));

  return selected;
}

// ─── MAIN ORCHESTRATOR ──────────────────────────────────────
// state: auction.html's live `state` object
// allPlayers: auction.html's live `allPlayers` array (Tank01 player list)
function runDecisionEngine(state, allPlayers) {
  var decisionState = buildDecisionState(state, allPlayers || []);

  if (!decisionState.userTeam) {
    return { status: 'NO_USER_TEAM_SELECTED', recommendations: [], diagnostics: [], unscored: [], unscoredCount: 0 };
  }
  if (decisionState.totalOpenSlots <= 0) {
    return { status: 'ROSTER_FULL', recommendations: [], diagnostics: [], unscored: decisionState.unscored, unscoredCount: decisionState.unscored.length };
  }

  var diagnostics = decisionState.remaining.map(function (player) {
    // DEF-only ADP rank, attached for the sort tie-break below. Never read
    // by scorePlayer()/applyHardRules()/computeMaxPriceForPlayer() -- those
    // are all called with just `player`, unchanged. Undefined for every
    // other position, including K.
    var positionRank = player.pos === 'DEF' ? decisionState.defRankLookup[player.name.toLowerCase()] : undefined;

    var hardRuleResult = applyHardRules(player, decisionState);
    if (hardRuleResult.vetoed) {
      return {
        player: player.name,
        pos: player.pos,
        targetPrice: player.targetPrice,
        vetoed: true,
        vetoCode: hardRuleResult.code,
        action: 'PASS',
        source: 'hard_rule',
        finalScore: 0,
        positionRank: positionRank
      };
    }

    var scores = scorePlayer(player, decisionState);
    var action = classifyAction(scores.finalScore);
    var maxPrice = computeMaxPriceForPlayer(player, decisionState);

    return {
      player: player.name,
      pos: player.pos,
      targetPrice: player.targetPrice,
      vetoed: false,
      action: action,
      source: 'deterministic',
      maxPrice: maxPrice,
      valueScore: scores.valueScore,
      needScore: scores.needScore,
      inflationScore: scores.inflationScore,
      strategyScore: scores.strategyScore,
      budgetScore: scores.budgetScore,
      finalScore: scores.finalScore,
      positionRank: positionRank,
      positionalInflationUsed: scores.positionalInflationUsed,
      positionalInflationSample: scores.positionalInflationSample,
      positionalInflationFallback: scores.positionalInflationFallback,
      reasonCodes: buildReasonCodes(player.pos, scores),
      riskCodes: buildRiskCodes(player.pos, scores, decisionState)
    };
  });

  // Primary sort: finalScore, unchanged. Secondary sort: ONLY when both
  // sides are DEF and finalScore is exactly tied, prefer the better (lower)
  // ADP rank -- this is the entire fix. Every other tie (non-DEF vs
  // non-DEF, DEF vs non-DEF, K vs K) returns 0 and falls through to JS's
  // guaranteed-stable Array.sort(), preserving whatever order the ties
  // already had before this feature existed.
  diagnostics.sort(function (a, b) {
    var scoreDiff = b.finalScore - a.finalScore;
    if (scoreDiff !== 0) return scoreDiff;
    if (a.pos === 'DEF' && b.pos === 'DEF' &&
        typeof a.positionRank === 'number' && typeof b.positionRank === 'number') {
      return a.positionRank - b.positionRank;
    }
    return 0;
  });

  var recommendations = selectRecommendationSet(diagnostics, decisionState);

  return {
    status: recommendations.length ? 'RECOMMENDATIONS' : 'NO_VIABLE_PLAYERS',
    recommendations: recommendations,
    diagnostics: diagnostics,
    unscored: decisionState.unscored,
    unscoredCount: decisionState.unscored.length,
    decisionStateSummary: {
      userTeam: decisionState.userTeam,
      userBudgetRemaining: decisionState.userBudgetRemaining,
      totalOpenSlots: decisionState.totalOpenSlots,
      maxAffordable: decisionState.maxAffordable,
      globalInflation: decisionState.globalInflation,
      positionalInflation: decisionState.positionalInflation,
      scoringFormat: decisionState.scoringFormat
    }
  };
}

// ─── EXPORTS ─────────────────────────────────────────────────
// Browser (auction.html <script src>): these stay plain top-level
// functions/vars in global scope, unaffected by this block.
// Node (decision-engine.test.js): exposes runDecisionEngine plus the
// internals needed for scenario assertions, without changing anything
// about how the file behaves when loaded as a page script.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    runDecisionEngine: runDecisionEngine,
    buildDecisionState: buildDecisionState,
    scorePlayer: scorePlayer,
    applyHardRules: applyHardRules,
    classifyAction: classifyAction,
    clamp01: clamp01,
    selectRecommendationSet: selectRecommendationSet,
    hasOpenCoreOffensiveStarterSlot: hasOpenCoreOffensiveStarterSlot,
    buildRationale: buildRationale,
    computeValueRoleScore: computeValueRoleScore,
    ALTERNATIVE_TARGET_CLOSE_SCORE_MARGIN: ALTERNATIVE_TARGET_CLOSE_SCORE_MARGIN,
    INFLATION_SCORE_NEUTRAL: INFLATION_SCORE_NEUTRAL,
    THRESHOLD_TARGET: THRESHOLD_TARGET,
    THRESHOLD_WATCH: THRESHOLD_WATCH
  };
}
