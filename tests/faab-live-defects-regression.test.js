'use strict';

const assert = require('assert');
const candidates = require('../netlify/functions/waiver-candidates.js')._test;
const decisions = require('../netlify/functions/waiver-decision.js')._test;
const recommendations = require('../netlify/functions/waiver-recommendations.js')._test;
const mcp = require('../netlify/functions/chatgpt-mcp.js')._test;

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS: ${name}`);
}

test('CBS FA and dated W statuses normalize as provider-available', () => {
  for (const status of ['FA', 'W (9/23)', 'W(9/23)', 'W']) {
    assert.strictEqual(candidates.isProviderAvailableStatus({ availabilityStatus: status }), true);
    assert.strictEqual(decisions.isAvailable({ availabilityStatus: status }), true);
  }
});

test('unique canonical name and position survives stale team metadata', () => {
  const row = { name: 'Example Receiver Jr.', position: 'WR', team: 'NYJ' };
  const result = candidates.findIdentityMatch(
    { name: 'Example Receiver', position: 'WR', team: 'GB', providerPlayerId: '123' },
    [row]
  );
  assert.strictEqual(result.match, row);
  assert.strictEqual(result.reason, 'team_mismatch_accepted');
});

test('position mismatch and ambiguous duplicates still fail safely', () => {
  assert.strictEqual(candidates.findIdentityMatch(
    { name: 'Same Player', position: 'TE', team: 'DEN' },
    [{ name: 'Same Player', position: 'WR', team: 'DEN' }]
  ).match, null);
  assert.strictEqual(candidates.findIdentityMatch(
    { name: 'Duplicate Player', position: 'WR', team: 'SEA' },
    [
      { name: 'Duplicate Player', position: 'WR', team: 'SEA' },
      { name: 'Duplicate Player', position: 'WR', team: 'MIA' }
    ]
  ).match, null);
});

test('connected roster rows may tolerate stale team only when name and position are unique', () => {
  const row = { name: 'Connected Receiver', position: 'WR', team: 'NYJ' };
  assert.strictEqual(candidates.findIdentityMatch(
    { name: 'Connected Receiver', position: 'WR', team: 'GB' },
    [row],
    { allowStaleTeam: true }
  ).match, row);
  assert.strictEqual(candidates.findIdentityMatch(
    { name: 'Connected Receiver', position: 'TE', team: 'GB' },
    [row],
    { allowStaleTeam: true }
  ).match, null);
});

test('actual WIDE BODIES roster resolves against canonical identity independently of sparse Week 2 SAGE', () => {
  const roster = [
    ['3139477', 'Patrick Mahomes', 'QB', 'KC'], ['3929630', 'Saquon Barkley', 'RB', 'PHI'],
    ['4362238', 'Chase Brown', 'RB', 'CIN'], ['3116165', 'Chris Godwin', 'WR', 'TB'],
    ['4595348', 'Malik Nabers', 'WR', 'NYG'], ['4431459', 'Tyler Warren', 'TE', 'IND'],
    ['4239996', 'Travis Etienne', 'RB', 'JAX'], ['3121422', 'Terry McLaurin', 'WR', 'WAS'],
    ['4034949', 'Eddy Pineiro', 'K', 'SF'], ['NE', 'NE', 'DEF', 'NE'],
    ['4429096', 'Blake Corum', 'RB', 'LAR'], ['4702555', 'Jonah Coleman', 'RB', 'DEN'],
    ['4832955', 'Emmett Johnson', 'RB', 'KC'], ['2991662', 'Mack Hollins', 'WR', 'NE'],
    ['3916433', 'Jakobi Meyers', 'WR', 'LV'], ['3128429', 'Courtland Sutton', 'WR', 'DEN']
  ].map(([playerId, name, position, team]) => ({ playerId, name, position, team }));
  const registry = roster.filter((row) => row.position !== 'DEF').map((row) => ({
    playerID: row.playerId,
    name: row.name === 'Chris Godwin' ? 'Chris Godwin Jr.' :
      row.name === 'Travis Etienne' ? 'Travis Etienne Jr.' : row.name,
    position: row.position === 'K' ? 'K' : row.position,
    team: row.name === 'Jakobi Meyers' ? 'JAX' :
      row.name === 'Travis Etienne' ? 'NO' : row.team
  }));
  const weekly = [
    { playerID: '4595348', name: 'Malik Nabers', position: 'WR', team: 'NYG' },
    { playerID: '4429096', name: 'Blake Corum', position: 'RB', team: 'LAR' }
  ];
  const results = candidates.classifyRosterIdentities(roster, registry, weekly);
  assert.strictEqual(results.filter((row) => row.status !== 'unidentified').length, 16);
  assert.strictEqual(results.filter((row) => row.status === 'identified_with_weekly_sage').length, 2);
  assert.strictEqual(results.filter((row) => row.status === 'identified_without_weekly_sage').length, 14);
});

test('canonical identity prefers stable ID and fails closed on position conflict and ambiguity', () => {
  const registry = [
    { playerID: '1', name: 'Shared Name', position: 'WR', team: 'SEA' },
    { playerID: '2', name: 'Shared Name', position: 'WR', team: 'MIA' }
  ];
  assert.strictEqual(
    candidates.resolveCanonicalIdentity({ playerId: '1', name: 'Old Name', position: 'WR' }, registry).reason,
    'stable_id'
  );
  assert.strictEqual(
    candidates.resolveCanonicalIdentity({ playerId: '1', name: 'Shared Name', position: 'TE' }, registry).reason,
    'position_conflict'
  );
  assert.strictEqual(
    candidates.resolveCanonicalIdentity({ name: 'Shared Name', position: 'WR' }, registry).reason,
    'ambiguous_name_position'
  );
});

test('recommended stash names a concrete weakest roster drop', () => {
  const [item] = recommendations.buildCustomerRecommendations([{
    name: 'Candidate Back', position: 'RB', team: 'SEA',
    decision: { action: 'WATCH', actionable: false },
    evidence: {
      sage: { position: 'RB', positionRank: 20 },
      opportunity: { lastGameOpportunities: 12, lastGameCarries: 10, lastGameTargets: 2 },
      rosterImpact: {
        classification: 'SIMILAR', comparisonType: 'starting-lineup', candidateStarts: false,
        depthComparison: {
          classification: 'UPGRADE',
          weakestComparable: { name: 'Weak Bench Back', position: 'RB', team: 'NYG', sage: { positionRank: 40 } }
        }
      }
    }
  }], { teams: 12, scoring: 'half-ppr' });
  assert.strictEqual(item.verdict, 'STASH');
  assert.deepStrictEqual(item.swapFor, { name: 'Weak Bench Back', position: 'RB', team: 'NYG' });
});

test('FAAB budget precedence is connected settings, user, then unknown', () => {
  assert.deepStrictEqual(
    recommendations.resolveFaabBudget({
      originalFaabBudget: 100,
      connection: { settings: { faabBudget: 250 } }
    }),
    { budget: 250, source: 'connected-league-settings' }
  );
  assert.deepStrictEqual(
    recommendations.resolveFaabBudget({ originalFaabBudget: 100 }),
    { budget: 100, source: 'user-provided' }
  );
  assert.deepStrictEqual(
    recommendations.resolveFaabBudget({}),
    { budget: null, source: 'unknown' }
  );
});

test('MCP budget resolver follows the same precedence without assuming 200', () => {
  assert.deepStrictEqual(
    mcp.resolveToolFaabBudget({ settings: { waiverBudget: 300 } }, 200),
    { budget: 300, source: 'connected-league-settings' }
  );
  assert.deepStrictEqual(mcp.resolveToolFaabBudget({}, 125), { budget: 125, source: 'user-provided' });
  assert.deepStrictEqual(mcp.resolveToolFaabBudget({}, undefined), { budget: null, source: 'unknown' });
});

test('matching coverage fails closed instead of recommending a blind claim', () => {
  assert.strictEqual(recommendations.matchingCoverageAdequate({
    rosterPlayersReceived: 16,
    rosterIdentified: 1,
    rosterSageMatched: 1,
    rosterMatchCoverage: 1 / 16
  }), false);
  assert.strictEqual(recommendations.matchingCoverageAdequate({
    rosterPlayersReceived: 16,
    rosterIdentified: 12,
    rosterSageMatched: 2,
    rosterMatchCoverage: 0.75
  }), true);
});

test('Week 2 remains current through Monday night', () => {
  assert.strictEqual(
    recommendations.derive2026RegularSeasonWeek(new Date('2026-09-22T05:59:59Z')),
    2
  );
});

console.log(`${passed} FAAB live-defect regression assertions passed, 0 failed.`);
