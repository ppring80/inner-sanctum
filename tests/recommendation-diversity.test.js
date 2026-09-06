// tests/recommendation-diversity.test.js
//
// Regression tests for the roster-aware, position-diverse recommendation
// selection added to:
//   - netlify/functions/sage-recommend.js  (selectDiverseRecommendations)
//   - decision-engine.js                    (selectRecommendationSet's
//                                             Value Target diversity step)
//
// Both are pure functions over synthetic fixtures -- no Tank01, no
// network, no Blobs. Run: node tests/recommendation-diversity.test.js

const path = require('path');
const sageRecommend = require(path.join(__dirname, '..', 'netlify', 'functions', 'sage-recommend.js'));
const decisionEngine = require(path.join(__dirname, '..', 'decision-engine.js'));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}

// ═══════════════════════════════════════════════════════════════
// SAGE-RECOMMEND.JS (Draft Command Center) — selectDiverseRecommendations
// ═══════════════════════════════════════════════════════════════

const { selectDiverseRecommendations, positionNeedTier, isExceptionalValue } = sageRecommend._test;

function evalEntry(name, pos, code) {
  return { player: { name, pos, team: null }, adp: 1, sage: { code, recommendation: code, explanation: '', reasons: [] }, missing: [] };
}

console.log('=== sage-recommend.js: selectDiverseRecommendations ===');

// 1. Empty roster (no rosterContext at all) -- must behave exactly as
// the old plain slice(0, N) did.
{
  const evaluated = [evalEntry('A', 'RB', 'consider'), evalEntry('B', 'RB', 'consider'), evalEntry('C', 'WR', 'consider')];
  const result = selectDiverseRecommendations(evaluated, null, 5);
  check('1. Empty roster (no rosterContext): behaves like plain slice, no filtering', result.length === 3 && result[0].player.name === 'A');
}

// 2. One RB drafted, one RB slot still open -- RB should still be
// eligible (DIRECT need), no unwanted exclusion.
{
  const rosterContext = { remainingDedicated: { QB: 1, RB: 1, WR: 2, TE: 1, K: 1, DEF: 1 }, remainingFlex: 1, flexEligible: ['RB', 'WR', 'TE'] };
  const evaluated = [evalEntry('RB1', 'RB', 'take-now'), evalEntry('RB2', 'RB', 'strong-consideration'), evalEntry('WR1', 'WR', 'consider')];
  const result = selectDiverseRecommendations(evaluated, rosterContext, 5);
  check('2. One RB drafted, one RB slot open: RB still fully eligible (DIRECT tier)', positionNeedTier('RB', rosterContext) === 'DIRECT');
  check('2. All 3 candidates still selected (no artificial exclusion)', result.length === 3);
}

// 3. Both starting RB slots filled, FLEX also filled -- RB is SATISFIED.
// A non-exceptional RB should be deferred in favor of a real WR
// alternative; an exceptional RB should still get through.
{
  const rosterContext = { remainingDedicated: { QB: 1, RB: 0, WR: 1, TE: 1, K: 1, DEF: 1 }, remainingFlex: 0, flexEligible: ['RB', 'WR', 'TE'] };
  check('3. Both RB slots filled + FLEX filled: RB correctly classified SATISFIED', positionNeedTier('RB', rosterContext) === 'SATISFIED');

  const evaluatedNonExceptional = [evalEntry('RB1', 'RB', 'consider'), evalEntry('WR1', 'WR', 'strong-consideration'), evalEntry('TE1', 'TE', 'consider')];
  const result1 = selectDiverseRecommendations(evaluatedNonExceptional, rosterContext, 3);
  check('3a. Non-exceptional RB at filled position is deferred behind a viable WR alternative',
    result1[0].player.name === 'WR1', result1.map(r => r.player.name));

  const evaluatedExceptional = [evalEntry('RB1', 'RB', 'take-now'), evalEntry('WR1', 'WR', 'consider'), evalEntry('TE1', 'TE', 'consider')];
  const result2 = selectDiverseRecommendations(evaluatedExceptional, rosterContext, 3);
  check('3b. Exceptional-value RB (take-now) at filled position is NOT blocked -- still recommended first',
    result2[0].player.name === 'RB1', result2.map(r => r.player.name));
}

// 4. Both WR slots filled -- mirrors RB case, confirming this isn't
// hardcoded to one position.
{
  const rosterContext = { remainingDedicated: { QB: 1, RB: 1, WR: 0, TE: 1, K: 1, DEF: 1 }, remainingFlex: 1, flexEligible: ['RB', 'WR', 'TE'] };
  check('4. Both WR slots filled, FLEX still open: WR is FLEX-eligible, so NOT satisfied yet', positionNeedTier('WR', rosterContext) === 'FLEX');
}

// 5. FLEX still open -- a position with 0 remaining dedicated slots
// but FLEX open should classify as FLEX, not SATISFIED.
{
  const rosterContext = { remainingDedicated: { QB: 1, RB: 0, WR: 1, TE: 1, K: 1, DEF: 1 }, remainingFlex: 2, flexEligible: ['RB', 'WR', 'TE'] };
  check('5. RB dedicated full, FLEX open: correctly classified FLEX (still eligible), not SATISFIED', positionNeedTier('RB', rosterContext) === 'FLEX');
}

// 6. FLEX filled (0 remaining) as well as dedicated -- now truly
// SATISFIED for a FLEX-eligible position.
{
  const rosterContext = { remainingDedicated: { QB: 1, RB: 0, WR: 1, TE: 1, K: 1, DEF: 1 }, remainingFlex: 0, flexEligible: ['RB', 'WR', 'TE'] };
  check('6. RB dedicated AND flex both full: correctly SATISFIED', positionNeedTier('RB', rosterContext) === 'SATISFIED');
}

// 7. Late-draft roster -- nearly everything filled, only bench-style
// depth remains. Diversity logic must not artificially withhold
// recommendations when few positions have real need; backfill should
// still produce a full batch from whatever is available.
{
  const rosterContext = { remainingDedicated: { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 }, remainingFlex: 0, flexEligible: ['RB', 'WR', 'TE'] };
  const evaluated = [evalEntry('RB1', 'RB', 'consider'), evalEntry('RB2', 'RB', 'consider'), evalEntry('WR1', 'WR', 'consider'), evalEntry('WR2', 'WR', 'flexible'), evalEntry('TE1', 'TE', 'flexible')];
  const result = selectDiverseRecommendations(evaluated, rosterContext, 5);
  check('7. Late-draft (everything SATISFIED): still backfills to a full 5-player batch, none withheld', result.length === 5);
}

// 8. Exceptional-value player at an already-filled position (explicit,
// dedicated re-check of requirement 5's own wording).
{
  const rosterContext = { remainingDedicated: { QB: 1, RB: 0, WR: 1, TE: 1, K: 1, DEF: 1 }, remainingFlex: 0, flexEligible: ['RB', 'WR', 'TE'] };
  check('8. isExceptionalValue() correctly identifies take-now as exceptional', isExceptionalValue(evalEntry('X', 'RB', 'take-now')) === true);
  check('8. isExceptionalValue() correctly rejects a merely-good, non-top category', isExceptionalValue(evalEntry('X', 'RB', 'strong-consideration')) === false);
}

// 9. Recommendation set containing viable players from multiple
// positions -- confirms the per-position cap actually diversifies a
// batch where one position would otherwise dominate purely by
// standalone order.
{
  const rosterContext = { remainingDedicated: { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1 }, remainingFlex: 1, flexEligible: ['RB', 'WR', 'TE'] };
  const evaluated = [
    evalEntry('RB1', 'RB', 'take-now'), evalEntry('RB2', 'RB', 'take-now'), evalEntry('RB3', 'RB', 'take-now'),
    evalEntry('RB4', 'RB', 'strong-consideration'), evalEntry('WR1', 'WR', 'strong-consideration'), evalEntry('TE1', 'TE', 'consider')
  ];
  const result = selectDiverseRecommendations(evaluated, rosterContext, 5);
  const positions = result.map(r => r.player.pos);
  const rbCount = positions.filter(p => p === 'RB').length;
  check('9. Per-position cap limits RB to at most 3 of 5 even when RB dominates standalone order', rbCount <= 3, positions);
  check('9. WR1 (a viable different-position alternative) makes the final batch', result.some(r => r.player.name === 'WR1'), positions);
}

console.log('');
console.log('=== decision-engine.js: selectRecommendationSet Value Target diversity ===');

const { selectRecommendationSet } = decisionEngine;

function diag(name, pos, finalScore, valueScore, budgetScore, inflationScore) {
  return { player: { name: name, pos: pos }, pos: pos, finalScore: finalScore, valueScore: valueScore, budgetScore: budgetScore, inflationScore: inflationScore, vetoed: false, positionRank: 1, action: 'BID', reasonCodes: [], riskCodes: [] };
}

const neutralUserRoster = { openDirect: { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 }, flexRemainingCapacity: 0, benchRemainingCapacity: 5, rosterTargets: { K: 1, DEF: 1 } };

// A. Value Target prefers a genuinely competitive different-position
// candidate over a third same-position repeat.
{
  const sorted = [
    diag('RB1', 'RB', 100, 0.95, 0.9, 0.9),
    diag('RB2', 'RB', 95, 0.9, 0.85, 0.85),
    diag('WR1', 'WR', 90, 0.88, 0.9, 0.9),
    diag('RB3', 'RB', 85, 0.5, 0.5, 0.5)
  ];
  const decisionState = { userRoster: neutralUserRoster };
  const result = selectRecommendationSet(sorted, decisionState);
  const names = result.recommendations.map(r => r.player.name);
  check('A. Value Target prefers competitive different-position WR over a 3rd same-position RB',
    names.indexOf('WR1') !== -1, names);
}

// B. When no genuinely competitive different-position candidate
// exists (real scarcity), falls back to same-position -- matching
// Pat's own documented "3 RBs may be correct" philosophy.
{
  const sorted = [
    diag('RB1', 'RB', 100, 0.95, 0.9, 0.9),
    diag('RB2', 'RB', 95, 0.9, 0.85, 0.85),
    diag('RB3', 'RB', 90, 0.85, 0.8, 0.8),
    diag('WR1', 'WR', 20, 0.05, 0.05, 0.05)
  ];
  const decisionState = { userRoster: neutralUserRoster };
  const result = selectRecommendationSet(sorted, decisionState);
  const names = result.recommendations.map(r => r.player.name);
  check('B. Genuine scarcity (no competitive alternative): 3 same-position RBs still allowed, matching existing documented philosophy',
    names.filter(function (n) { return n === 'RB1' || n === 'RB2' || n === 'RB3'; }).length === 3, names);
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
