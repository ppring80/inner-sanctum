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
const { buildServer, extractRosterEntries } = require('../netlify/functions/chatgpt-mcp')._test;
const tools = buildServer(new Request('https://fixture.invalid/.netlify/functions/chatgpt-mcp'), null).tools;
const text = result => result.content.map(x => x.text || '').join('\n');
const compare = (players, externalAnalysisRequested = false) => tools.compare_players.callback({
  players, season: 2026, week: 7, scoring: 'ppr', externalAnalysisRequested
});

(async () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const sandbox = { window: {}, document: { addEventListener() {} }, console, setTimeout };
  vm.runInNewContext(fs.readFileSync(require.resolve('../provider-adapters.js'), 'utf8'), sandbox);
  // Execute the existing provider extraction functions with synthetic source data.
  const bridge=fs.readFileSync(require.resolve('../cbs-extension/espn-main-bridge.js'),'utf8');
  const extraction=bridge.slice(bridge.indexOf('  function normalizeRoster('),bridge.indexOf('  function normalizeStandings('));
  const normalizedSource=vm.runInNewContext(extraction+';normalizeRoster', {ESPN_DEFAULT_POSITION_BY_ID:{3:'WR'},NFL_TEAM_BY_ID:{1:'AAA'},projectedPoints:()=>0});
  const captured=normalizedSource({roster:{entries:[{lineupSlotId:23,playerPoolEntry:{player:{id:'synthetic-1',fullName:'Fixture WR',defaultPositionId:3,proTeamId:1}}}]}},7)[0];
  assert.equal(captured.lineupSlotId,23); assert.equal(captured.defaultPositionId,3);
  const teamSource=fs.readFileSync(require.resolve('../team-context.js'),'utf8');
  const teamExtraction=teamSource.slice(teamSource.indexOf('  function normalizeEspnRoster('),teamSource.indexOf('  function detectEspnScoringFormat('));
  const normalizeTeam=vm.runInNewContext(teamExtraction+';normalizeEspnRoster',{numberOrNull:v=>v==null?null:Number(v),ESPN_TEAM_BY_ID:{1:'AAA'},ESPN_POSITION_BY_ID:{3:'WR'},findEspnProjection:()=>0});
  const switched=normalizeTeam({roster:{entries:[{lineupSlotId:4,playerPoolEntry:{player:{id:'synthetic-2',fullName:'Fixture WR',defaultPositionId:3,proTeamId:1}}}]}},{scoringPeriodId:7})[0];
  assert.equal(switched.lineupSlotId,4); assert.equal(switched.defaultPositionId,3);
  const rawRoster = [{ name: 'Kendrick Bourne', position: 'WR', providerPlayerId: 'synthetic-1', lineupSlotId: 4, defaultPositionId: 3 },
    { name: 'T.J. Hockenson', position: 'TE', providerPlayerId: 'synthetic-2', lineupSlot: 'Bench' }];
  const source = { roster: rawRoster };
  const before = JSON.stringify(source);
  const adapted = JSON.parse(JSON.stringify(sandbox.window.normalizeLeagueData('espn', source)));
  assert.equal(adapted.roster[0].lineupSlotId, 4);
  assert.equal(adapted.roster[0].providerPlayerId, 'synthetic-1');
  assert.equal(adapted.roster[1].lineupSlot, 'Bench');
  const snapshot = { provider: 'espn', league: { id: 'fixture-league', season: 2026, scoringPeriodId: 7 }, team: { id: 'fixture-team' }, week: 7,
    meta: { source: 'espn-browser-assisted', capturedAt: '2026-10-22T12:00:00Z' }, roster: adapted.roster };
  const normalized = extractRosterEntries(snapshot);
  const ctx = normalized[0].lineupContext;
  assert.equal(ctx.leagueId, 'fixture-league'); assert.equal(ctx.teamId, 'fixture-team');
  assert.equal(ctx.season, 2026); assert.equal(ctx.week, 7); assert.equal(ctx.scoringPeriodId, 7);
  assert.equal(ctx.originalSlotId, '4'); assert.equal(ctx.defaultPositionId, '3');
  assert.equal(ctx.playerId, 'synthetic-1'); assert.equal(ctx.asOf, snapshot.meta.capturedAt);
  assert.deepEqual(ctx.lock, { state: 'unknown', source: null, asOf: null });
  assert.equal(ctx.eligibility.status, 'unknown');
  assert.equal(normalized[1].lineupContext.originalSlotLabel, 'Bench');
  assert.equal(extractRosterEntries({...snapshot, provider:'cbs'})[0].lineupContext, undefined);
  const absent = extractRosterEntries({...snapshot, meta:{}, roster:[{name:'Fixture',position:'WR',locked:false,eligibleSlots:[4]}]})[0].lineupContext;
  assert.equal(absent.lock.state, 'unknown'); assert.equal(absent.eligibility.status, 'unknown'); assert.equal(absent.asOf,null);
  assert.equal(JSON.stringify(source),before);
  const build = roster => buildServer(new Request('https://fixture.invalid/.netlify/functions/chatgpt-mcp'), { snapshot: {
    provider:'espn', league:{id:'fixture-league',season:2026,teamCount:12}, team:{id:'fixture-team'}, scoringFormat:'ppr', roster,
    settings:{lineupSlots:[{slot:'FLEX',count:1}]} } }).tools;
  const plainRoster=rawRoster.map(({name,position})=>({name,position}));
  const baseline=await build(plainRoster).get_lineup_recommendation.callback({season:2026,week:7});
  const withMetadata=await build(rawRoster).get_lineup_recommendation.callback({season:2026,week:7});
  assert.deepEqual(withMetadata,baseline,'passive context must not change customer response, authority decision ID, confidence or starters');
  for (const [file,pattern] of [['../cbs-extension/espn-main-bridge.js',/lineupSlotId: entry\?\.lineupSlotId/],['../team-context.js',/lineupSlotId: entry\?\.lineupSlotId/]]) {
    assert.match(fs.readFileSync(require.resolve(file),'utf8'),pattern);
  }
  console.log('PASS: verified ESPN assignment facts survive adapter/MCP normalization; unsupported eligibility/locks stay unknown; customer response and decision identity unchanged.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  Module._load = originalLoad; global.fetch = originalFetch;
});
