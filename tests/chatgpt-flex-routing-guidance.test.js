'use strict';

const assert = require('node:assert/strict');
const Module = require('module');
const originalLoad = Module._load;
const originalFetch = global.fetch;
let fetches = 0;
const rankings = { positions: {
  WR: [{ name: 'Kendrick Bourne', position: 'WR', team: 'ARI', rank: 38, recommendation: 'FLEX' }],
  TE: [{ name: 'T.J. Hockenson', position: 'TE', team: 'MIN', rank: 9, recommendation: 'START' },
    { name: 'Control Tight End', position: 'TE', rank: 15, recommendation: 'FLEX' }]
} };
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
global.fetch = async url => {
  fetches++;
  return { ok: true, status: 200,
    json: async () => String(url).includes('/weekly-sage-rankings?') ? rankings : {} };
};
const { buildServer } = require('../netlify/functions/chatgpt-mcp')._test;
const tools = buildServer(new Request('https://fixture.invalid/.netlify/functions/chatgpt-mcp'), null).tools;
const text = result => result.content.map(x => x.text || '').join('\n');
const compare = (players, externalAnalysisRequested = false) => tools.compare_players.callback({
  players, season: 2026, week: 7, scoring: 'ppr', externalAnalysisRequested
});

(async () => {
  const sourceBefore = JSON.stringify(rankings);
  const orders = [['Kendrick Bourne', 'T.J. Hockenson'], ['T.J. Hockenson', 'Kendrick Bourne']];
  let first;
  for (const players of orders) {
    const response = await compare(players);
    const result = response.structuredContent;
    assert.equal(result.comparison.final, false);
    assert.equal(result.comparison.preferredPlayer, null, 'guidance must not manufacture a winner');
    assert.match(result.comparison.basis[0], /no validated edge/);
    if (first) assert.deepEqual(result.comparison, first);
    first = result.comparison;
    assert.deepEqual(result.players.map(p => [p.profile.identity.name, p.profile.rankProjection.stats[0].value]),
      players.map(name => [name, name === 'Kendrick Bourne' ? '38' : '9']));
    assert.equal(result.authority.externalAnalysisAllowed, false);
    for (const guidance of [result.authority.hostInstruction, text(response)]) {
      assert.match(guidance, /Continue through get_lineup_recommendation/);
      assert.match(guidance, /Ask only for missing league size, scoring, FLEX eligibility/);
      assert.match(guidance, /Reuse known season, week, scoring/);
      assert.match(guidance, /default team count or scoring as confirmed/);
      assert.match(guidance, /Preserve a provisional result/);
      assert.match(guidance, /Do not browse, search for, cite/);
      assert.doesNotMatch(guidance, /comparison directly and stop|complete Inner Sanctum fantasy-analysis answer/);
    }

    // A diagnostic call with only known source context must clarify rather
    // than invent league size/slot assignments or use the linked league.
    const before = fetches;
    const missing = await tools.get_lineup_recommendation.callback({
      roster: players.map(name => ({ name, position: name === 'Kendrick Bourne' ? 'WR' : 'TE' })),
      season: 2026, week: 7, scoringFormat: 'ppr'
    });
    assert.equal(missing.structuredContent.error, 'league_team_count_unavailable');
    assert.equal(missing.structuredContent.inputSource, 'pasted_roster');
    assert.match(text(missing), /needs the league's team count/);
    assert.equal(fetches, before, 'missing context must be resolved before fetching/running lineup authority');
  }

  const final = await compare(['T.J. Hockenson', 'Control Tight End']);
  assert.equal(final.structuredContent.comparison.preferredPlayer, 'T.J. Hockenson');
  assert.equal(final.structuredContent.comparison.final, true);
  assert.match(final.structuredContent.authority.hostInstruction, /comparison directly and stop/);
  assert.doesNotMatch(text(final), /Continue through get_lineup_recommendation/);

  const outside = await compare(orders[0], true);
  assert.equal(outside.structuredContent.authority.externalAnalysisAllowed, true);
  assert.equal(outside.structuredContent.authority.mode, 'supplemental_allowed');
  assert.match(outside.structuredContent.authority.hostInstruction, /clearly separate any external information/);
  assert.match(text(outside), /Continue through get_lineup_recommendation/);

  const missing = await compare(['Kendrick Bourne', 'Unknown Player']);
  assert.equal(missing.structuredContent.error, 'insufficient_players_found');
  assert.doesNotMatch(missing.structuredContent.authority.hostInstruction, /Continue through/);
  assert.match(tools.compare_players.options.description, /unresolved cross-position FLEX\/start-sit question/);
  assert.doesNotMatch(tools.compare_players.options.description, /externalAnalysisAllowed=false, answer only/);
  assert.equal(JSON.stringify(rankings), sourceBefore);
  console.log('PASS: both Bourne/Hockenson orders preserve the unresolved decision and ranks, guide existing lineup continuation, clarify missing context, retain final-comparison behavior and outside-analysis restrictions, and perform no writes.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  Module._load = originalLoad;
  global.fetch = originalFetch;
});
