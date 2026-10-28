'use strict';
const assert = require('node:assert/strict');
const { buildWeeklyRankingExplanation } = require('../netlify/functions/sage-take');
const { buildLineupDecisionRecord } = require('../netlify/functions/_super-sage-lineup-decision');
const {_test} = require(process.env.WEEKLY_RANKING_MCP_BUNDLE || '../netlify/functions/chatgpt-mcp');
const now = new Date('2026-10-28T04:00:00Z');
const request = { season: 2026, week: 8, scoring: 'half', now };
const note = "Backfield role change: Fixture Backup (IR) unavailable. Prior rank needs reassessment. The share is not verified. Do not use the old rank alone to recommend dropping this player.";
const barkley = { name: 'Saquon Barkley', playerID: '3929630', position: 'RB', team: 'PHI', rank: 15,
  recommendation: 'START', projectedPoints: 12.41, projectionOrderMode: 'partial', projectionRankStatus: 'projected',
  projection: { points: 12.41, source: 'Tank01', season: '2026', week: 8, scoring: 'half', fresh: true },
  production: { adjustedScore: 60.7 }, matchup: { label: 'Negative' }, opponent: 'WSH',
  injuryStatus: 'QUESTIONABLE', injuryDescription: 'Synthetic long provider injury description.', availabilityVerified: true,
  sage: { confidence: .765, confidenceLabel: 'Moderate', label: 'Average' },
  roleContext: { status: 'REASSESS', absences: [{ name: 'Fixture Backup', status: 'IR' }], note },
  sageTake: note + ' A difficult matchup is driving the ranking despite strong production. Solid start.' };
const other = { ...barkley, name: 'Fixture Runner', playerID: 'fixture-2', rank: 16, injuryStatus: null, injuryDescription: null };
const kicker = { name: 'Fixture Kicker', playerID: 'fixture-k', position: 'K', team: 'PHI', rank: 1, recommendation: 'START', sageTake: 'Reliable kicking opportunities this week.' };
const event = { player: other.name, position: 'RB', team: 'PHI', season: 2026, week: 8,
  kind: 'ROLE_GAIN', explicitRole: 'STARTER', verified: true, fresh: true,
  authority: 'TEAM_ANNOUNCEMENT', sourceUrl: 'https://www.philadelphiaeagles.com/news/synthetic-fixture',
  effectiveAt: '2026-10-27T12:00:00Z', publishedAt: '2026-10-27T13:00:00Z', verifiedAt: '2026-10-27T14:00:00Z', dateBasis: 'EFFECTIVE',
  statement: 'The team named Fixture Runner its starter this week.' };
function frozen(value) { Object.values(value).forEach(v => { if (v && typeof v === 'object') frozen(v); }); return Object.freeze(value); }
async function main() {
  const before = JSON.stringify(barkley);
  const text = buildWeeklyRankingExplanation(barkley, request);
  assert.match(text, /RB15 · START: 12\.41 projected half-PPR points/);
  assert.match(text, /Difficult matchup against WSH/); assert.match(text, /Strong production/); assert.match(text, /Questionable/);
  assert(!/dropp|backfield role change|share is not verified|driving the ranking|Solid start|Synthetic long/i.test(text));
  assert.equal(JSON.stringify(barkley), before);
  const stale = buildWeeklyRankingExplanation({ ...barkley, projection: { ...barkley.projection, fresh: false } }, request);
  assert.match(stale, /Fresh projection evidence is unavailable/); assert(!stale.includes('driving the ranking'));
  assert(!/backfield|dropp|reassessment/i.test(buildWeeklyRankingExplanation(other, request)));
  const genuine = { ...other, roleContext: { event, note: event.statement + ' ' + note, priorContexts: [{ note }] } };
  assert(buildWeeklyRankingExplanation(genuine, request).includes(event.statement));
  for (const patch of [{ verified: false }, { fresh: false }, { player: 'Unrelated Player' }, { week: 7 }, { effectiveAt: null }, { kind: 'TEAMMATE_ABSENCE' }])
    assert(!buildWeeklyRankingExplanation({ ...genuine, roleContext: { ...genuine.roleContext, event: { ...event, ...patch } } }, request).includes(event.statement));
  assert.match(buildWeeklyRankingExplanation({ ...other, availabilityVerified: false }, request), /availability is unverified/);
  assert.match(buildWeeklyRankingExplanation({ ...other, injuryStatus: 'DOUBTFUL' }, request), /Doubtful/);
  assert.equal(buildWeeklyRankingExplanation(kicker, request), kicker.sageTake);
  const observed = { ...other, components: { opportunity: { source: 'Inner Sanctum Opportunity Intelligence',
    provenance: { season: '2026', weeksIncluded: [5, 6, 7] }, opportunities: { avgLast3: 12.3, gamesSampled: 3 } } } };
  assert.match(buildWeeklyRankingExplanation(observed, request), /12.3 carries plus targets per game over the last three games/);
  const future = structuredClone(observed); future.components.opportunity.provenance.weeksIncluded.push(8);
  assert(!buildWeeklyRankingExplanation(future, request).includes('Recent usage:'));
  const unprojected = { ...other, sageTake: 'Limited recent opportunity warrants caution.', roleContext: null, projectionRankStatus: 'unprojected' };
  assert.equal(buildWeeklyRankingExplanation(unprojected, request), unprojected.sageTake);

  const rankings = frozen({ season: 2026, week: 8, positions: { RB: [barkley, other], K: [kicker] }, metadata: { complete: true } });
  function record() { return buildLineupDecisionRecord({ rankings, roster: [{ name: barkley.name, position: 'RB', eligiblePositions: ['RB'] }, { name: other.name, position: 'RB', eligiblePositions: ['RB'] }], slots: [{ slotLabel: 'RB', eligiblePositions: ['RB'], count: 1 }], season: 2026, week: 8, scoring: 'half' }); }
  const original = JSON.stringify(rankings), decisionBefore = record();
  const fetchBefore = global.fetch;
  global.fetch = async url => {
    if (String(url).includes('/weekly-sage-rankings')) return Response.json(rankings);
    return Response.json({ defenses: {} });
  };
  try {
    const server = _test.buildServer(new Request('https://fixture.invalid/.netlify/functions/chatgpt-mcp'), {});
    const response = await server._registeredTools.get_weekly_rankings.handler({ position: 'RB', limit: 50, season: 2026, week: 8, scoring: 'half' });
    assert(!response.isError, JSON.stringify(response));
    const displayed = response.structuredContent.rankings;
    assert.equal(displayed[0].sageTake, buildWeeklyRankingExplanation(barkley, { ...request, now: new Date() }));
    assert.equal(displayed[0].rank, 15); assert.equal(displayed[0].recommendation, 'START');
    assert.equal(displayed[0].sageConfidence, .765); assert.equal(displayed[0].sageConfidenceLabel, 'Moderate');
    assert(!response.content[0].text.includes('dropping'));
    assert.equal(displayed[1].player, other.name); assert.equal(displayed[1].rank, 16);
    assert.equal(JSON.stringify(rankings), original, 'Source rows, role notes and evidence remain byte-identical');
    const decisionAfter = record();
    assert.equal(decisionAfter.decisionId, decisionBefore.decisionId);
    assert.deepEqual(decisionAfter, decisionBefore, 'Full decision record, starters, confidence and Rookie identity remain identical');
  } finally { global.fetch = fetchBefore; }
  console.log('PASS: MCP Weekly Rankings display only; Barkley/other RBs, verified role changes, injury/uncertainty and unchanged controls; immutable raw rows and identical complete decision records.');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
