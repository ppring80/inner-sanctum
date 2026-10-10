'use strict';
const assert = require('node:assert/strict');
const { validateClaims } = require('../netlify/functions/_super-sage-rookie-claim-checks');
const { validatePairVoice } = require('../netlify/functions/_super-sage-shadow-voice');
const { ROLE_SYSTEM, ROLE_SCHEMA, VERSION, validate, formatGroundedAnswer } = require('../netlify/functions/_super-sage-shadow-fast-review');
const fact = (id, field, value) => ({ factId: `${id}:${field}`, field, value });
const packet = { requireSentenceEvidence: true, requireBackfieldExplanation: true, players: [
 { id: 'A', name: 'Blake Corum', position: 'RB', facts: [
  fact('A', 'backfieldContext', { roleOrderVerified: false, players: [{ name: 'Kyren Williams' }, { name: 'Blake Corum' }] }),
  fact('A', 'observedOpportunity', { avgLast3: 10, lastGame: 7 }),
  fact('A', 'matchup', { label: 'Neutral' })
 ] },
 { id: 'B', name: 'Will Shipley', position: 'RB', facts: [
  fact('B', 'backfieldContext', { roleOrderVerified: true, reportedRoles: { candidateListedRank: 3, players: [
   { name: 'Saquon Barkley', listedRank: 1, status: 'OUT' }, { name: 'Tank Bigsby', listedRank: 2, status: 'IR' }, { name: 'Will Shipley', listedRank: 3, status: 'UNKNOWN' }
  ], notListedInChart: ['Dameon Pierce', 'Jaydon Blue'] } }),
  fact('B', 'stateChanges', [{ type: 'ROLE_CHANGE', verified: true }]),
  fact('B', 'roleExpansion', { validated: false }),
  fact('B', 'availability', { status: 'ACTIVE' }),
  fact('B', 'observedOpportunity', { avgLast3: 6, lastGame: 7 }),
  fact('B', 'matchup', { label: 'Strong Negative' })
 ] }
] };
const bytes = JSON.stringify(packet);
const roleText = "I'd start Shipley over Corum because Shipley sits first among the remaining backs on the team chart.";
assert.ok(!validateClaims({ explanation: roleText }, packet).includes('unverified_backfield_role_order'), 'Shipley role cannot be attributed to Corum');
for (const explanation of ['Corum sits second in the backfield.', 'Corum is the second back.', "I'd start Shipley, but Corum is the backup back."]) {
 assert.ok(validateClaims({ explanation }, packet).includes('unverified_backfield_role_order'), explanation);
}
assert.ok(!validateClaims({ explanation: "Corum faces uncertainty because Kyren Williams is the lead back." }, packet).includes('unverified_backfield_role_order'), 'different named back is not Corum');
assert.ok(validateClaims({ explanation: 'Corum recently averaged 10 touches per game.' }, packet).includes('observed_opportunity_unit_changed'));
assert.ok(!validateClaims({ explanation: 'Corum averaged 10 opportunities per game over his last three games.' }, packet).includes('observed_opportunity_unit_changed'));
assert.ok(validatePairVoice({ explanation: 'Both are sourced as unavailable.' }).includes('report_like_customer_language'));
assert.deepEqual(validatePairVoice({ explanation: 'Barkley is out and Bigsby is on injured reserve.' }), []);
const input = { selected: 'B', confidence: 'MEDIUM', caveat: "We don't know how the work will be divided.", reconsider: 'Confirmed pregame reporting that Pierce leads the backfield could change my choice.', explanationSentences: [
 { text: "I'd lean Shipley: Barkley is OUT and Bigsby is on IR, leaving Shipley first on the remaining team chart, although Shipley's chart status is UNKNOWN despite an ACTIVE listing.", factIds: ['B:backfieldContext', 'B:availability'] },
 { text: 'Corum averaged 10 opportunities per game over his last three games against 6 for Shipley, so Corum has the stronger recent baseline.', factIds: ['A:observedOpportunity', 'B:observedOpportunity'] },
 { text: "I expect Shipley could get more work after those absences, but Pierce and Blue are not listed on the chart and we don't know how the work will be divided.", factIds: ['B:backfieldContext', 'B:stateChanges', 'B:roleExpansion'] },
 { text: "Corum has the better matchup, but Shipley's remaining chart position tips my lean toward him.", factIds: ['A:matchup', 'B:matchup', 'B:backfieldContext'] }
] };
const answer = formatGroundedAnswer(input);
assert.deepEqual(validate(answer, packet), []);
const alternative = formatGroundedAnswer({ ...input, selected: 'A', explanationSentences: [
 { ...input.explanationSentences[0], text: input.explanationSentences[0].text.replace("I'd lean Shipley", "I'd lean Corum") },
 ...input.explanationSentences.slice(1, 3),
 { ...input.explanationSentences[3], text: "Shipley's remaining chart position gives him a possible opportunity increase, but Corum's stronger recent baseline and better matchup tip my lean toward Corum." }
] });
assert.deepEqual(validate(alternative, packet), [], 'either independently supported choice is valid');
assert.ok(validate({ ...answer, factIds: answer.factIds.filter(id => id !== 'B:observedOpportunity') }, packet).includes('missing_observed_usage_comparison'));
assert.ok(validate({ ...answer, explanation: answer.explanation.replace("Shipley's chart status is UNKNOWN despite an ACTIVE listing", 'he could play more') }, packet).includes('missing_candidate_health_uncertainty'));
assert.equal(JSON.stringify(packet), bytes);
assert.equal(VERSION, 'rookie-fast-pair-v6-haiku');
assert.equal(ROLE_SCHEMA.properties.explanationSentences.maxItems, 4);
assert.ok(!/60-80|90-120|three connected sentences|20-25/.test(ROLE_SYSTEM), 'role prompt has one consistent length contract');
assert.ok(!/Will Shipley|Blake Corum|Barkley|Bigsby/.test(ROLE_SYSTEM), 'no player-specific preferred answer');
console.log('Rookie grounded content: observed unit, named role attribution, plain status language, both usage baselines and own health uncertainty; either supported choice accepted. No provider calls or namespace changes.');
