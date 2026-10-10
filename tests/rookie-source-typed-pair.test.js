'use strict';
// Rookie role pair: each backfield source is presented as what it is, required
// disclosures are derived from supplied facts only, invented order/chart claims
// are rejected by packet-bound checks, and a natural answer for EITHER player
// fits the budget. Coverage and grounding only; not proof of judgment quality.
const assert = require('node:assert/strict');
const { hash } = require('../netlify/functions/_super-sage-shadow-llm');
const { focusEvidence, validate, ROLE_SYSTEM, boundRoleSchema } = require('../netlify/functions/_super-sage-shadow-fast-review');

const frozenPacket = { request: {}, players: [
  { name: 'Blake Corum', position: 'RB', facts: [
    { field: 'availability', value: { status: 'ACTIVE' } },
    { field: 'observedOpportunity', value: { avgLast3: 10, lastGame: 7, unit: 'carries plus targets' } },
    { field: 'backfieldContext', value: { team: 'LAR', source: 'Tank01', generatedAt: '2026-10-08T12:00:00Z', candidateSourceOrder: 2, roleOrderVerified: false,
      players: [{ name: 'Kyren Williams', sourceOrder: 1, availability: { status: 'ACTIVE' } }, { name: 'Blake Corum', sourceOrder: 2, availability: { status: 'UNKNOWN' } }],
      note: 'Cache order is derived from provider array position, not verified starter/backup roles.' } }] },
  { name: 'Will Shipley', position: 'RB', facts: [
    { field: 'availability', value: { status: 'ACTIVE' } },
    { field: 'observedOpportunity', value: { avgLast3: 6, lastGame: 7, unit: 'carries plus targets' } },
    { field: 'backfieldContext', value: { team: 'PHI', chartType: 'TEAM_PUBLISHED_UNOFFICIAL', roleOrderVerified: true,
      reportedRoles: { team: 'PHI', candidateListedRank: 3, nextListedAlternative: null, notListedInChart: ['Dameon Pierce', 'Jaydon Blue'],
        players: [{ name: 'Saquon Barkley', listedRank: 1, status: 'OUT' }, { name: 'Tank Bigsby', listedRank: 2, status: 'IR' }, { name: 'Will Shipley', listedRank: 3, status: 'UNKNOWN' }] } } },
    { field: 'roleExpansion', value: { validated: false } }] }] };
const frozen = { packet: frozenPacket, evidenceHash: hash(JSON.stringify(frozenPacket)) };
const before = JSON.stringify(frozen);
const { packet } = focusEvidence(frozen, ['Blake Corum', 'Will Shipley']);
packet.requireSentenceEvidence = true; packet.requireBackfieldExplanation = true; packet.requireCandidateStatusSentence = true;
const fact = (id, field) => packet.players.find(p => p.id === id).facts.find(f => f.field === field);

let passed = 0; const test = (name, fn) => { fn(); passed++; console.log('  ok - ' + name); };

test('frozen parent packet and hash are untouched by presentation', () => {
  assert.equal(JSON.stringify(frozen), before);
  assert.equal(hash(JSON.stringify(frozen.packet)), frozen.evidenceHash);
});
test('provider roster is labeled, order-free and excludes the candidate\'s own roster row', () => {
  const v = fact('A', 'backfieldContext').value;
  assert.equal(v.sourceType, 'PROVIDER_ROSTER_UNORDERED');
  assert.equal(v.roleOrderVerified, false);
  assert.doesNotMatch(JSON.stringify(v), /sourceOrder|candidateSourceOrder|"Blake Corum"/);
  assert.deepEqual(v.teammates, [{ name: 'Kyren Williams', providerRosterStatus: 'ACTIVE' }]);
});
test('team chart is labeled with its team and keeps its verified order', () => {
  const v = fact('B', 'backfieldContext').value;
  assert.equal(v.sourceType, 'TEAM_PUBLISHED_CHART'); assert.equal(v.chartTeam, 'PHI');
  assert.deepEqual(v.reportedRoles.players.map(p => p.listedRank), [1, 2, 3]);
});
test('required disclosures restate supplied facts only, bound to the right subject', () => {
  const d = Object.fromEntries(packet.requiredDisclosures.map(x => [x.type + ':' + x.playerId, x]));
  assert.equal(d['statusConflict:B'].name, 'Will Shipley');
  assert.match(d['statusConflict:B'].detail, /UNKNOWN.*ACTIVE.*not health confirmation/);
  assert.equal(d['statusConflict:A'], undefined, 'Corum has no chart, so no chart-status disclosure');
  assert.deepEqual(d['chartAhead:B'].backs.map(b => b.status), ['OUT', 'IR']);
  assert.deepEqual(d['absentFromChart:B'].names, ['Dameon Pierce', 'Jaydon Blue']);
  assert.equal(d['noVerifiedOrder:A'].team, 'LAR');
  assert.ok(d['workloadUnknown:B']);
  const ids = new Set(packet.players.flatMap(p => p.facts.map(f => f.factId)));
  packet.requiredDisclosures.forEach(x => x.factIds.forEach(id => assert.ok(ids.has(id), id)));
});
test('the status binding still names Shipley only', () => {
  assert.deepEqual(boundRoleSchema(packet).properties.statusSentence.properties.playerId.enum, ['B']);
});
test('the role prompt carries one disclosure contract, not a scattered checklist', () => {
  assert.match(ROLE_SYSTEM, /requiredDisclosures/);
  assert.match(ROLE_SYSTEM, /PROVIDER_ROSTER_UNORDERED supports teammate names and statuses only/);
  assert.doesNotMatch(ROLE_SYSTEM, /Name alternatives missing from the chart|Explain the team-published chart after excluding/);
});

const answer = (selected, sentences, status) => {
  const input = { selected, confidence: 'MEDIUM', statusSentence: status, explanationSentences: sentences,
    caveat: 'Neither backfield has a verified workload split for this week.', reconsider: 'Pick the other back if new reports show a clear lead role.' };
  const out = require('../netlify/functions/_super-sage-shadow-fast-review').formatGroundedAnswer(input);
  return out;
};
const STATUS = { playerId: 'B', text: "Shipley's spot on the Eagles' team chart shows UNKNOWN status even though his separate listing says ACTIVE, so his health isn't confirmed.", factIds: ['B:backfieldContext', 'B:availability'] };
const CHART = { text: 'With Barkley out and Bigsby on injured reserve, Shipley is next on the Eagles chart, but Pierce and Blue are absent from that chart and we do not know how the work will be divided.', factIds: ['B:backfieldContext', 'B:roleExpansion'] };
const words = a => a.explanation.trim().split(/\s+/).length;

test('a natural, complete Corum answer passes and fits the budget', () => {
  const a = answer('A', [
    { text: "I'd start Corum because he has averaged 10 recent opportunities a game over the last three games to Shipley's 6, even though both had 7 last game.", factIds: ['A:observedOpportunity', 'B:observedOpportunity'] },
    CHART,
    { text: "There is no verified Rams depth order, so Corum's share could move, but his steadier recent involvement still makes him my lean.", factIds: ['A:backfieldContext', 'A:observedOpportunity'] }], STATUS);
  assert.deepEqual(validate(a, packet), []);
  assert.ok(words(a) <= 160, String(words(a)));
});
test('a natural, complete Shipley answer passes too (either player may be chosen)', () => {
  const a = answer('B', [
    { text: "I'd start Shipley, even though Corum has averaged 10 recent opportunities a game over the last three games to his 6, because both had 7 last game.", factIds: ['A:observedOpportunity', 'B:observedOpportunity'] },
    CHART,
    { text: "There is no verified Rams depth order either, so I accept Shipley's health question for his chance at more Eagles work.", factIds: ['A:backfieldContext', 'B:roleExpansion'] }], STATUS);
  assert.deepEqual(validate(a, packet), []);
  assert.ok(words(a) <= 160, String(words(a)));
});
test('invented Rams order or a Rams "chart" is rejected; honest wording is not', () => {
  const base = s => answer('A', [
    { text: "I'd start Corum because he has averaged 10 recent opportunities a game over the last three games to Shipley's 6.", factIds: ['A:observedOpportunity', 'B:observedOpportunity'] },
    CHART, { text: s, factIds: ['A:backfieldContext'] }], STATUS);
  for (const s of ['Kyren Williams is still ahead of Corum in the Rams backfield.', 'Corum sits behind Kyren Williams.', 'Corum is the backup to Kyren Williams.', 'The Rams chart lists Corum as UNKNOWN.', 'Kyren Williams is ahead of Corum, though the order is not verified.'])
    assert.ok(validate(base(s), packet).some(e => e === 'unverified_backfield_role_order' || e === 'provider_roster_called_chart'), s);
  assert.ok(!validate(base('There is no verified Rams depth order, so Corum and Kyren Williams could split work.'), packet).some(e => /role_order|called_chart/.test(e)));
});
test('wrong status subject and missing absence are still rejected', () => {
  const wrong = answer('A', [
    { text: "I'd start Corum because he has averaged 10 recent opportunities a game over the last three games to Shipley's 6.", factIds: ['A:observedOpportunity', 'B:observedOpportunity'] },
    { text: 'With Barkley out and Bigsby on injured reserve, Shipley is next; Pierce and Blue could also play and the work split is unknown.', factIds: ['B:backfieldContext', 'B:roleExpansion'] }],
    { playerId: 'B', text: "Corum's status is UNKNOWN despite an ACTIVE listing.", factIds: ['B:backfieldContext', 'B:availability'] });
  const errors = validate(wrong, packet);
  assert.ok(errors.includes('wrong_status_subject'), errors.join(','));
  assert.ok(errors.includes('missing_uncharted_alternative'), errors.join(','));
});
console.log('rookie-source-typed-pair.test.js: ' + passed + ' passed');

const sourced = JSON.parse(JSON.stringify(frozen));
const roster = sourced.packet.players[0].facts.find(f => f.field === 'backfieldContext');
roster.value.players[0].availability = { status: 'IR', source: 'Official transaction', sourceUrl: 'https://example.test/transaction', reportedAt: '2026-10-08T10:00:00Z' };
const presented = focusEvidence(sourced, ['Blake Corum', 'Will Shipley']).packet.players[0].facts.find(f => f.field === 'backfieldContext').value.teammates[0];
assert.equal(presented.providerRosterStatus, 'IR');
assert.equal(presented.statusSource, 'Official transaction');
assert.equal(presented.statusSourceUrl, 'https://example.test/transaction');
assert.equal(presented.statusReportedAt, '2026-10-08T10:00:00Z');
