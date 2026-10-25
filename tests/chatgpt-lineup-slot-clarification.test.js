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
  const tool = tools.get_lineup_recommendation;
  const base = { scoringFormat: 'ppr', teamCount: 12, season: 2026, week: 7, provider: 'Fictional' };
  const candidates = [{ name: 'Kendrick Bourne', position: 'WR' }, { name: 'T.J. Hockenson', position: 'TE' }];
  for (const roster of [candidates, candidates.slice().reverse(),
    [{ ...candidates[0], lineupSlot: 'FLEX' }, candidates[1]]]) {
    const before = fetches;
    const original = JSON.stringify(roster);
    const response = await tool.callback({ ...base, roster });
    const result = response.structuredContent;
    tool.options.outputSchema.parse(result);
    assert.equal(result.error, 'roster_slot_context_unavailable');
    assert.equal(result.lineupRequirementsAvailable, false);
    assert.equal(Object.hasOwn(result, 'superSage'), false);
    assert.deepEqual(result.starters, []);
    assert.equal(result.context.league.teamCount, 12);
    assert.equal(result.context.league.season, 2026);
    assert.equal(result.context.scoring, 'ppr');
    assert.equal(result.context.week, 7);
    assert.equal(result.context.provider, 'Fictional');
    assert.match(text(response), /available/);
    assert.ok(text(response).includes(JSON.stringify(roster)));
    assert.equal(JSON.stringify(roster), original);
    assert.equal(fetches, before, 'clarification precedes evidence retrieval/authority');
    if (roster[0].lineupSlot) {
      assert.match(text(response), /Which roster slot applies to T.J. Hockenson/);
      assert.doesNotMatch(text(response), /which positions does it allow/);
    } else assert.match(text(response), /which positions does it allow/);
  }
  const complete = await tool.callback({ ...base, roster: candidates.map((p,i) => ({...p, lineupSlot:i?'BN':'FLEX'})) });
  tool.options.outputSchema.parse(complete.structuredContent);
  assert.equal(complete.structuredContent.lineupRequirementsAvailable, true);
  assert.equal(complete.structuredContent.superSage.authority, 'super-sage-lineup-decision');
  assert.ok(complete.structuredContent.superSage.decisionId);
  assert.equal(complete.structuredContent.superSage.decision[0].decisionState, 'PROVISIONAL_UNRESOLVED');
  assert.equal(complete.structuredContent.superSage.decision[0].hasValidatedEdge, false);
  console.log('PASS: missing/partial slots clarify without fetches/defaults, context retained, output schema valid, complete context uses unchanged provisional authority.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  Module._load = originalLoad;
  global.fetch = originalFetch;
});
