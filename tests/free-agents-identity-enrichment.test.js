'use strict';

// tests/free-agents-identity-enrichment.test.js
//
// Regression coverage for the identity-matching fix in
// netlify/functions/waiver-candidates.js: reusing player-identity.js's
// already-proven canonical-name matching, plus the proven DEF team-code
// canonicalization fix and defensive PK->K position normalization.
//
// Root cause under test: espn-main-bridge.js's ESPN free-agent capture
// (normalizeAvailablePlayers) never applied the same defense team-code
// canonicalization the ESPN roster capture already does, so provider
// defense names ("Jacksonville Jaguars") never matched Weekly SAGE's
// own canonical team-code defense rows ("JAX") -- even though the
// correct team code was already present on every candidate via
// getPlayerTeam()/nflTeam. This is fixed entirely downstream in
// waiver-candidates.js; no provider capture file was changed.
//
// Run: node tests/free-agents-identity-enrichment.test.js

const assert = require('assert');
const {
  findIdentityMatch,
  getPlayerName,
  normalizePosition,
  enrichCandidates
} = require('../netlify/functions/waiver-candidates.js')._test;

let passed = 0;
let failed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    failed += 1;
    failures.push(`${name} :: ${err && err.message ? err.message : err}`);
  }
}

// ── DEF/DST/D-ST identity normalization ──

test('ESPN-style raw defense display name resolves to its already-known team code', () => {
  // Exactly the proven root cause shape: raw ESPN display name, with the
  // correct team code already present via nflTeam (proTeamId resolved
  // upstream), just never used for identity before this fix.
  const candidate = { name: 'Jacksonville Jaguars', position: 'DEF', nflTeam: 'JAX' };
  assert.strictEqual(getPlayerName(candidate), 'JAX');
});

test('a defense candidate already reported as a team code is unaffected', () => {
  const candidate = { name: 'JAX', position: 'DEF', team: 'JAX' };
  assert.strictEqual(getPlayerName(candidate), 'JAX');
});

test('DEF identity match succeeds against a Weekly SAGE row keyed by team code', () => {
  const candidate = { name: 'Jacksonville Jaguars', position: 'D/ST', nflTeam: 'JAX' };
  const sageRows = [{ name: 'JAX', position: 'DEF', team: 'JAX', sageScore: 12 }];
  const result = findIdentityMatch(candidate, sageRows);
  assert.strictEqual(result.match, sageRows[0]);
  assert.strictEqual(result.reason, null);
});

test('D-ST and DST spelling variants normalize identically to DEF', () => {
  assert.strictEqual(normalizePosition('DST'), 'DEF');
  assert.strictEqual(normalizePosition('D/ST'), 'DEF');
  assert.strictEqual(normalizePosition('D-ST'), 'DEF');
  assert.strictEqual(normalizePosition('DEFENSE'), 'DEF');
});

test('a genuinely different defense (wrong team code) does not falsely match', () => {
  const candidate = { name: 'Los Angeles Chargers', position: 'DEF', nflTeam: 'LAC' };
  const sageRows = [{ name: 'JAX', position: 'DEF', team: 'JAX' }];
  const result = findIdentityMatch(candidate, sageRows);
  assert.strictEqual(result.match, null);
});

// ── PK/K identity normalization ──

test('PK normalizes defensively to K (no proven live occurrence, but zero risk to the K path)', () => {
  assert.strictEqual(normalizePosition('PK'), 'K');
  assert.strictEqual(normalizePosition('K'), 'K');
});

test('a kicker candidate reported as PK still matches a Weekly SAGE row keyed by K', () => {
  const candidate = { name: 'Test Kicker', position: 'PK', team: 'DAL' };
  const sageRows = [{ name: 'Test Kicker', position: 'K', team: 'DAL', sageScore: 8 }];
  const result = findIdentityMatch(candidate, sageRows);
  assert.strictEqual(result.match, sageRows[0]);
});

// ── Reused player-identity.js matching for skill positions ──

test('a known active skill player with a generational suffix still matches (player-identity.js suffix handling)', () => {
  const candidate = { name: 'Test Player Jr.', position: 'RB', team: 'KC' };
  const sageRows = [{ name: 'Test Player', position: 'RB', team: 'KC', sageScore: 15 }];
  const result = findIdentityMatch(candidate, sageRows);
  assert.strictEqual(result.match, sageRows[0], 'Jr./Sr./II-V suffix differences must not block an otherwise exact match');
});

test('an ambiguous same-name, same-position, different-team pair does not guess', () => {
  const candidate = { name: 'Duplicate Player', position: 'WR', team: 'SEA' };
  const sageRows = [
    { name: 'Duplicate Player', position: 'WR', team: 'SEA' },
    { name: 'Duplicate Player', position: 'WR', team: 'MIA' }
  ];
  const result = findIdentityMatch(candidate, sageRows);
  assert.strictEqual(result.match, null);
});

test('a same-name, different-position candidate does not match (position safety preserved)', () => {
  const candidate = { name: 'Same Name', position: 'TE', team: 'DEN' };
  const sageRows = [{ name: 'Same Name', position: 'WR', team: 'DEN' }];
  const result = findIdentityMatch(candidate, sageRows);
  assert.strictEqual(result.match, null);
});

// ── End-to-end enrichment through enrichCandidates() ──

test('an active, SAGE-matched player is enriched with real evidence end-to-end', () => {
  const availablePlayers = [
    { providerPlayerId: '1', name: 'Test Enriched Player', position: 'WR', team: 'BUF', availabilityStatus: 'FREE_AGENT', projectedPoints: 9.4 }
  ];
  const weeklyData = {
    positions: {
      WR: [{ name: 'Test Enriched Player', position: 'WR', team: 'BUF', positionRank: 22, sageScore: 8.5, recommendation: 'consider' }]
    }
  };
  const enriched = enrichCandidates({ availablePlayers, roster: [], weeklyData, risersFallersData: null });
  assert.strictEqual(enriched.length, 1);
  assert.strictEqual(enriched[0].identity.sageMatched, true);
  assert.strictEqual(enriched[0].sage.positionRank, 22);
});

test('a player with genuinely no SAGE coverage remains unmatched rather than fabricated', () => {
  const availablePlayers = [
    { providerPlayerId: '2', name: 'Deep Bench Nobody', position: 'WR', team: 'BUF', availabilityStatus: 'FREE_AGENT', projectedPoints: 0.1 }
  ];
  const weeklyData = { positions: { WR: [{ name: 'Someone Else', position: 'WR', team: 'BUF', positionRank: 1 }] } };
  const enriched = enrichCandidates({ availablePlayers, roster: [], weeklyData, risersFallersData: null });
  assert.strictEqual(enriched[0].identity.sageMatched, false);
  assert.strictEqual(enriched[0].sage, null, 'no evidence must remain null, never invented');
});

console.log('');
console.log(`free-agents-identity-enrichment.test.js: ${passed}/${passed + failed} passed`);
if (failed > 0) {
  failures.forEach((f) => console.error('FAIL:', f));
  process.exitCode = 1;
}
