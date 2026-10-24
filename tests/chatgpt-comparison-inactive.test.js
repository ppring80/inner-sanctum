'use strict';

// Reproduce the customer comparison/profile mismatch without network or writes.
const assert = require('node:assert/strict');
const Module = require('module');
const originalLoad = Module._load;
const originalFetch = global.fetch;
let rankings;
Module._load = function(request, parent, isMain) {
  if (request === '@modelcontextprotocol/server') return {
    createMcpHandler: () => {},
    McpServer: class {
      constructor() { this.tools = {}; }
      registerTool(name, options, callback) { this.tools[name] = { options, callback }; }
    }
  };
  if (request === '@netlify/blobs') return {
    getStore: () => ({ get: async () => null, setJSON: async () => { throw new Error('Unexpected write'); } })
  };
  return originalLoad.call(this, request, parent, isMain);
};
global.fetch = async url => ({
  ok: true, status: 200,
  json: async () => String(url).includes('/weekly-sage-rankings?') ? rankings : {}
});

const { buildServer } = require('../netlify/functions/chatgpt-mcp')._test;
const tools = buildServer(new Request('https://fixture.invalid/.netlify/functions/chatgpt-mcp'), null).tools;
const active = (name, rank) => ({ name, position: 'RB', team: 'NO', rank, recommendation: 'FLEX' });
const unavailable = (name, reason) => ({ name, position: 'RB', team: 'MIN', status: 'IR', reason,
  // An inactive entry's stale scores must never participate in the choice.
  rank: 1, overallRank: 1, adp: 1, sage: { score: 100, confidence: 1 } });
const compare = players => tools.compare_players.callback({ players, season: 2026, week: 7, scoring: 'half' });
const text = result => result.content.map(x => x.text || '').join('\n');

(async () => {
  rankings = { positions: { RB: [active('First Back', 20), active('Second Back', 30)] },
    inactive: { RB: [unavailable('Jordan Mason', 'Provider reports IR.'), unavailable('Inactive Back', 'Unavailable: OUT')] } };
  const before = JSON.stringify(rankings);
  const baseline = await compare(['First Back', 'Second Back']);
  const mixed = await compare(['First Back', 'Jordan Mason', 'Second Back', 'Unknown Player']);
  assert.deepEqual(mixed.structuredContent.comparison, baseline.structuredContent.comparison,
    'adding inactive/missing players cannot change the active-player decision');
  const mason = mixed.structuredContent.players.find(p => p.requestedName === 'Jordan Mason');
  const profile = await tools.get_player_profile.callback({ player: 'Jordan Mason', season: 2026, week: 7, scoring: 'half' });
  assert.equal(mason.found, true);
  assert.deepEqual(mason.profile.verdict, profile.structuredContent.profile.verdict);
  assert.equal(mason.profile.verdict.action, 'INELIGIBLE');
  assert.equal(mason.profile.rankProjection, null);
  assert.match(text(mixed), /Jordan Mason: INELIGIBLE — Provider reports IR\./);
  assert.match(text(mixed), /Not found: Unknown Player/);
  assert.doesNotMatch(text(mixed), /Not found:.*Jordan Mason/);

  const one = await compare(['First Back', 'Jordan Mason']);
  assert.equal(one.isError, true);
  assert.equal(one.structuredContent.comparison.preferredPlayer, null);
  assert.match(text(one), /Jordan Mason: INELIGIBLE — Provider reports IR\./);
  assert.match(text(one), /Fewer than two eligible players/);
  const none = await compare(['Jordan Mason', 'Inactive Back']);
  assert.equal(none.structuredContent.comparison.final, false);
  assert.match(text(none), /Inactive Back: INELIGIBLE — Unavailable: OUT/);
  const ambiguous = await compare(['First Back', 'Mason']);
  assert.equal(ambiguous.structuredContent.players[1].found, false,
    'inactive fallback must not infer an identity from a surname');
  assert.equal(JSON.stringify(rankings), before, 'source rankings are never mutated');
  console.log('PASS: registered comparison tool preserves inactive identity/reason, excludes stale inactive ranks, preserves active decisions, fails closed with fewer than two eligible players, and keeps unknown names distinct.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  Module._load = originalLoad;
  global.fetch = originalFetch;
});
