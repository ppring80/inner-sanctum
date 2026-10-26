'use strict';

// Public identities with synthetic kickoff exclusions; no league data or network.
const assert = require('node:assert/strict');
const Module = require('module');
const originalLoad = Module._load;
const originalFetch = global.fetch;
let rankings;
const requests = [];
Module._load = function(request, parent, isMain) {
  if (request === '@modelcontextprotocol/server') return {
    createMcpHandler: () => {}, McpServer: class {
      constructor() { this.tools = {}; }
      registerTool(name, options, callback) { this.tools[name] = { options, callback }; }
    }
  };
  if (request === '@netlify/blobs') return {
    getStore: () => ({ get: async () => null, setJSON: async () => { throw Error('Unexpected write'); } })
  };
  return originalLoad.call(this, request, parent, isMain);
};
global.fetch = async url => {
  requests.push(String(url));
  assert.match(String(url), /\/weekly-sage-(rankings|matchup-defense|game-environment)\?/);
  return { ok: true, status: 200,
    json: async () => String(url).includes('/weekly-sage-rankings?') ? rankings : {} };
};
const { buildServer } = require('../netlify/functions/chatgpt-mcp')._test;
const tools = buildServer(new Request('https://fixture.invalid/.netlify/functions/chatgpt-mcp'), null).tools;
const names = [
  ['Ashton Jeanty', '4890973', 'RB'], ['Jaylen Warren', '4569987', 'RB'],
  ['Michael Wilson', '4360761', 'WR'], ['Joe Burrow', '3915511', 'QB'],
  ['Jordan Love', '4036378', 'QB']
];
const excluded = names.map(([name, playerID, position]) => ({ name, playerID, position,
  // These stale fields must never leak into a verdict or influence a winner.
  rank: 1, overallRank: 1, recommendation: 'START', status: 'IR',
  sage: { score: 100, confidence: 1 }, injuryDescription: 'stale synthetic injury' }));
const active = (name, rank) => ({ name, playerID: name, position: 'RB', rank, recommendation: 'FLEX' });
const fixture = () => ({ positions: { RB: [active('First Back', 20), active('Second Back', 30)] },
  metadata: { gameEligibility: { excluded: structuredClone(excluded) } } });
const text = r => r.content.map(c => c.text || '').join('\n');
const compare = async (players, week = 7) => {
  const r = await tools.compare_players.callback({ players, season: 2026, week, scoring: 'standard' });
  tools.compare_players.options.outputSchema.parse(r.structuredContent);
  return r;
};
const profile = async (player, week = 7) => {
  const r = await tools.get_player_profile.callback({ player, season: 2026, week, scoring: 'standard' });
  tools.get_player_profile.options.outputSchema.parse(r.structuredContent);
  return r;
};
(async () => {
  rankings = fixture();
  const baseline = await compare(['First Back', 'Second Back']);
  const baselineProfile = await profile('First Back');
  const source = JSON.stringify(rankings);
  for (const [name, id, position] of names) {
    const p = await profile(name);
    assert.equal(p.isError, undefined);
    assert.equal(p.structuredContent.found, true);
    assert.equal(p.structuredContent.profile.identity.playerID, id);
    assert.equal(p.structuredContent.profile.identity.position, position);
    assert.equal(p.structuredContent.profile.verdict.action, 'GAME_STARTED');
    assert.equal(p.structuredContent.profile.rankProjection, null);
    assert.equal(p.structuredContent.profile.verdict.confidence, null);
    assert.match(text(p), /game has already started.*cannot be newly selected for Week 7 lineup changes/);
    assert.doesNotMatch(text(p), /injur|\bIR\b|bye|not found|INELIGIBLE|stale/i);
    for (const players of [[name, 'First Back'], ['First Back', name]]) {
      const r = await compare(players);
      assert.equal(r.structuredContent.comparison.preferredPlayer, null);
      assert.equal(r.structuredContent.comparison.final, false);
      assert.deepEqual(r.structuredContent.players.find(x => x.requestedName === name).profile, p.structuredContent.profile);
      assert.match(text(r), /GAME_STARTED.*Week 7 lineup changes/);
      assert.doesNotMatch(text(r), /Not found:/);
    }
    const r = await compare(['First Back', name, 'Second Back']);
    assert.deepEqual(r.structuredContent.comparison, baseline.structuredContent.comparison);
  }
  const none = await compare(['Joe Burrow', 'Jordan Love']);
  assert.equal(none.structuredContent.comparison.preferredPlayer, null);
  assert.equal(none.structuredContent.players.every(p => p.found), true);
  assert.match(text(await profile('Jordan Love', 12)), /Week 12 lineup changes/);
  for (const name of ['Unknown Player', 'Warren', 'Wilson']) {
    assert.equal((await profile(name)).structuredContent.error, 'player_not_found');
    const r = await compare(['First Back', name]);
    assert.equal(r.structuredContent.players[1].found, false);
    assert.match(text(r), /could not find enough/);
  }
  assert.equal(JSON.stringify(rankings), source, 'source rankings untouched');
  rankings.metadata.gameEligibility.excluded.push({ ...excluded[0] });
  assert.equal((await profile('Ashton Jeanty')).structuredContent.found, false, 'ambiguous metadata fails closed');
  rankings = fixture();
  rankings.metadata.gameEligibility.excluded.push({ ...excluded[0], name: 'First Back' });
  assert.deepEqual((await profile('First Back')).structuredContent, baselineProfile.structuredContent, 'actionable row takes precedence');
  assert.deepEqual((await compare(['First Back', 'Second Back'])).structuredContent, baseline.structuredContent);
  for (const metadata of [undefined, {}, { gameEligibility: { excluded: {} } }]) {
    rankings.metadata = metadata;
    assert.equal((await profile('Jordan Love')).structuredContent.error, 'player_not_found');
  }
  assert.ok(requests.filter(u => u.includes('/weekly-sage-rankings?')).every(u =>
    !u.includes('evidenceUsage') && u.includes('season=2026') && u.includes('scoring=standard')),
    'no archive bypass or new provider endpoint');
  console.log('PASS: five kickoff-excluded identities, both orderings, mixed/active/unknown controls, exact fail-closed fallback, schema validity and unchanged source evidence.');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => {
  Module._load = originalLoad; global.fetch = originalFetch;
});
