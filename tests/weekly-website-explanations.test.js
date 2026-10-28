'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../weekly.html'), 'utf8');
const start = html.indexOf('function weeklyDisplayExplanation(row) {');
const end = html.indexOf('function mapWeeklyRowToProfileModel(', start);
assert(start > 0 && end > start, 'Display-only helper must exist before profile presenter');
const sandbox = { getScoringFormat: () => 'half' };
vm.runInNewContext(html.slice(start, end), sandbox);
const row = {
  playerID: 'fixture-1', name: 'Fixture Back', pos: 'RB', positionRank: 15,
  providerProjectedPoints: 12.41, matchup: 'Negative', opp: 'WSH',
  injury: 'questionable', eligibleForWeeklyRanking: true,
  sageTake: "Backfield role change: teammates unavailable. Fixture Back's prior workload and weekly rank need reassessment. The absence alone does not establish increased work; the share is not verified. Do not use the old rank alone to recommend dropping this player. A difficult matchup is driving the ranking despite strong production. Solid start."
};
const before = JSON.stringify(row);
const result = sandbox.weeklyDisplayExplanation(row);
assert(result.includes('RB15') && result.includes('12.4 projected half-PPR points'));
assert(result.includes('Difficult matchup against WSH'));
assert(result.includes('Questionable; confirm status before kickoff.'));
assert(!/drop|backfield role|driving the ranking|solid start/i.test(result));
assert.equal(JSON.stringify(row), before, 'Formatting must not mutate decision evidence');
const supported = { ...row, sageTake: 'Verified direct role change: more carries after starter ruled out.' };
assert.equal(sandbox.weeklyDisplayExplanation(supported), supported.sageTake, 'Supported specific prose survives');
const xss = sandbox.weeklyEscapeHtml('<img src=x onerror="bad">&');
assert.equal(xss, '&lt;img src=x onerror=&quot;bad&quot;&gt;&amp;');
assert(html.includes('insight: weeklyDisplayExplanation(row)'), 'Profile uses display-only prose');
assert(html.includes('weeklyEscapeHtml(verdictText)'), 'Table escapes display prose');
assert(html.includes('? weeklyDisplayExplanation(p)'), 'Table uses display-only prose');
console.log('Website weekly explanation display checks passed');

const mixed = { ...row, sageTake: row.sageTake + ' The team confirmed a larger role this week. Current availability is unverified.' };
assert(sandbox.weeklyDisplayExplanation(mixed).includes('The team confirmed a larger role this week.'));
assert(sandbox.weeklyDisplayExplanation(mixed).includes('Current availability is unverified.'));
assert(!/backfield role|dropping/.test(sandbox.weeklyDisplayExplanation(mixed)));
assert(sandbox.weeklyDisplayExplanation({...row, opp:'vs WSH'}).includes('against WSH.'));
// Exercise the actual normalization/profile boundary, not a hand-mapped display row.
const flattenStart = html.indexOf('function weeklyMatchupLabel(');
vm.runInNewContext(html.slice(flattenStart, html.indexOf('function loadWeeklyRankings()', flattenStart)), sandbox);
sandbox.buildWeeklyRisks = () => null;
vm.runInNewContext(html.slice(end, html.indexOf('function getEffectiveCall(', end)), sandbox);
const { buildLineupDecisionRecord } = require('../netlify/functions/_super-sage-lineup-decision');
const evidence = {season:2026,week:8,positions:{RB:[{
  playerID:row.playerID,name:row.name,position:'RB',team:'PHI',rank:15,
  recommendation:'START',projectedPoints:12.41,injuryStatus:'QUESTIONABLE',
  sage:{confidence:0.765,confidenceLabel:'Moderate'},sageTake:row.sageTake
}, {playerID:'fixture-2',name:'Fixture Alternative',position:'RB',team:'SEA',rank:16,recommendation:'FLEX'}]}};
function decision() { return buildLineupDecisionRecord({rankings:evidence,
  roster:evidence.positions.RB.map(p=>({name:p.name,position:p.position,eligiblePositions:['RB']})),
  slots:[{slotLabel:'RB',eligiblePositions:['RB'],count:1}],season:2026,week:8,scoring:'half'}); }
const originalEvidence = JSON.stringify(evidence), originalDecision = JSON.stringify(decision());
const flattened = sandbox.flattenRankings(evidence), originalFlattened = JSON.stringify(flattened);
for (const player of flattened) {
  const model = sandbox.mapWeeklyRowToProfileModel(player);
  assert.equal(model.identity.playerID, player.playerID);
  assert.equal(model.identity.name, player.name);
  assert.equal(model.verdict.confidence, player.sageConfidenceLabel);
  sandbox.weeklyEscapeHtml(sandbox.weeklyDisplayExplanation(player));
}
assert.equal(JSON.stringify(flattened), originalFlattened);
assert.equal(JSON.stringify(evidence), originalEvidence);
assert.equal(JSON.stringify(decision()), originalDecision, 'Decision IDs, Rookie lookup identity, starters and confidence unchanged');

for (const sentence of ['A strong role is driving the ranking despite a difficult matchup.', 'Limited production is driving the ranking despite a favorable matchup.'])
  assert(!sandbox.weeklyDisplayExplanation({...row, sageTake:sentence}).includes('driving the ranking'));

assert(sandbox.weeklyDisplayExplanation({...row, sageTake:'Strong production and a strong role support the ranking.'}).includes('support his outlook'));

for (const sentence of ["This week's difficult matchup is driving the ranking.", 'A strong role is driving the ranking.', 'Limited production is driving the ranking.'])
  assert(!sandbox.weeklyDisplayExplanation({...row,sageTake:sentence}).includes('driving the ranking'));
