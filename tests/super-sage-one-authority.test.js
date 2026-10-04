'use strict';

// tests/super-sage-one-authority.test.js
//
// ONE Super SAGE decision authority:
//  * ChatGPT MCP and the website endpoint, given the same league inputs and
//    the same Weekly SAGE payload, return the SAME decisionId and decisions;
//  * both build the identical Weekly SAGE request;
//  * the website page only PRESENTS the record (no local ranking, slot
//    filling or fallback);
//  * consumer source contains no local lineup optimizer.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.join(__dirname, 'fixtures', 'super-sage-week4');
const rankings = JSON.parse(fs.readFileSync(path.join(DIR, 'production-rankings.json'), 'utf8'));
const roster = JSON.parse(fs.readFileSync(path.join(DIR, 'roster.json'), 'utf8'));
const mcp = require('../netlify/functions/chatgpt-mcp.js');
const site = require('../netlify/functions/super-sage-lineup.js');

let passed = 0;
async function test(name, fn) { await fn(); passed += 1; console.log('  ok - ' + name); }

const SLOT_COUNTS = [['QB', 1], ['RB', 2], ['WR', 2], ['TE', 1], ['FLEX', 2]];
const FLEX = ['RB', 'WR', 'TE'];

(async () => {
  const requested = [];
  const oldFetch = global.fetch;
  global.fetch = async (url) => { requested.push(String(url)); return { ok: true, status: 200, json: async () => rankings }; };

  let mcpResult, siteBody;
  try {
    const server = mcp._test.buildServer(new Request('https://fixture.invalid/.netlify/functions/chatgpt-mcp'), {
      snapshot: { provider: 'cbs', scoringFormat: 'half-ppr', league: { season: 2026, teamCount: 12 },
        roster: roster.roster.map((p) => ({ name: p.name, position: p.position, status: p.rosterStatus || null })),
        settings: { lineupSlots: SLOT_COUNTS.map(([slot, count]) => ({ slot, count })) } }
    });
    mcpResult = await server._registeredTools.get_lineup_recommendation.handler({ season: 2026, week: 4 });

    const res = await site._test.handler({
      httpMethod: 'POST', headers: { host: 'fixture.invalid', 'x-forwarded-proto': 'https' },
      body: JSON.stringify({ season: 2026, week: 4, scoring: 'half', teams: 12, provider: 'cbs',
        roster: roster.roster.map((p) => ({ name: p.name, position: p.position, rosterStatus: p.rosterStatus || null })),
        slots: SLOT_COUNTS.map(([slot, count]) => ({ slotLabel: slot, eligiblePositions: slot === 'FLEX' ? FLEX : [slot], count })) })
    }, { connectLambda() {}, readSchedule: async () => { throw new Error('Weekly SAGE schedule cache could not be read.'); }, getStore() { throw new Error('No Blobs context (test).'); }, fetch: global.fetch });
    siteBody = JSON.parse(res.body);
  } finally { global.fetch = oldFetch; }

  await test('both consumers send the identical Weekly SAGE request', async () => {
    assert.strictEqual(requested.length, 2, requested.join('\n'));
    const strip = (u) => { const x = new URL(u); return x.pathname + '?' + [...x.searchParams.entries()].sort().map((e) => e.join('=')).join('&'); };
    assert.strictEqual(strip(requested[0]), strip(requested[1]));
  });

  await test('MCP and the website return the SAME decisionId and decisions', async () => {
    assert.ok(!mcpResult.isError, JSON.stringify(mcpResult.structuredContent && mcpResult.structuredContent.warnings));
    const m = mcpResult.structuredContent.superSage;
    assert.strictEqual(siteBody.status, 'DECIDED');
    assert.ok(m && m.decisionId, 'MCP exposes the decisionId');
    assert.strictEqual(m.decisionId, siteBody.decisionId, 'decisionId parity');
    const siteDecision = siteBody.record.slots.map((s) => ({ slot: s.slotLabel, starter: s.starter ? s.starter.name : null, decisionState: s.decisionState, confidence: s.confidence.label }));
    assert.deepStrictEqual(m.decision.map((s) => ({ slot: s.slot, starter: s.starter, decisionState: s.decisionState, confidence: s.confidence })), siteDecision);
    assert.deepStrictEqual(m.customerAnswer, siteBody.customerAnswer, 'identical 1/3/10 answer');
  });

  await test('MCP presents the record: starters/bench come from it, never re-derived', async () => {
    const sc = mcpResult.structuredContent;
    assert.deepStrictEqual(sc.starters.map((s) => [s.slot, s.player]), siteBody.record.slots.filter((s) => s.starter).map((s) => [s.slotLabel, s.starter.name]));
    assert.ok(sc.bench.every((b) => b.rosterImplication === 'NONE'), 'bench never implies drop');
    assert.match(mcpResult.content[0].text, /^Start: /, 'initial output leads with the 1-second lineup');
  });

  await test('consumer source has no local lineup optimizer', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'netlify', 'functions', 'chatgpt-mcp.js'), 'utf8');
    const tool = src.slice(src.indexOf('"get_lineup_recommendation"'), src.indexOf('TOOL #6'));
    assert.ok(!/assignLineupSlotsOptimally\(|lineupPlayerValue\(/.test(tool), 'MCP lineup tool must not call the local optimizer');
    const html = fs.readFileSync(path.join(__dirname, '..', 'weekly.html'), 'utf8');
    const fn = html.slice(html.indexOf('function getRosterLineupAssignments() {'), html.indexOf('function renderSuperSageAnswer() {'));
    assert.ok(!/fillSlots|lineupRankingValue|\.sort\(/.test(fn), 'website assignment must not rank or fill slots locally');
  });

  // Website page client in a VM: presents the record only.
  const html = fs.readFileSync(path.join(__dirname, '..', 'weekly.html'), 'utf8');
  const grab = (name) => { const i = html.indexOf(`function ${name}(`); return html.slice(i, html.indexOf('\n}\n', i) + 3); };
  const clientSrc = 'var superSageLineup = { key: null, status: "idle", data: null, error: null };\n' +
    ['superSageLineupSlots', 'superSageLineupRequest', 'requestSuperSageLineup', 'getRosterLineupAssignments', 'renderSuperSageAnswer', 'rosterLineupTag'].map(grab).join('\n');
  function pageContext(respond) {
    const box = { hidden: true, innerHTML: '' };
    const calls = [];
    const ctx = {
      state: { myRosterNames: roster.roster.map((p) => p.name), myRosterOnly: true, connectedRosterDetails: roster.roster.map((p) => ({ name: p.name, position: p.position, rosterStatus: p.rosterStatus || null })), connectedProvider: 'cbs', connectedTeamCount: 12 },
      FLEX_ELIGIBLE: { FLEX: FLEX, SFLEX: ['QB', 'RB', 'WR', 'TE'] },
      getWeeklyLineupConstruction: () => ({ QB: 1, RB: 2, WR: 2, TE: 1, K: 0, DEF: 0, FLEX: 2, SUPERFLEX: 0 }),
      getAllRows: () => [], getSelectedSeason: () => '2026', getSelectedWeek: () => 4, getScoringFormat: () => 'half',
      callTag: (c) => `[${c}]`, renderTable() { ctx.renders += 1; }, renders: 0,
      document: { getElementById: (id) => (id === 'superSageAnswer' ? box : null) },
      fetch: (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return respond(); }, JSON, Object, String, Number
    };
    vm.createContext(ctx); vm.runInContext(clientSrc, ctx);
    return { ctx, box, calls };
  }
  const tick = () => new Promise((r) => setImmediate(r));

  await test('page: before the decision arrives, no player is marked START', async () => {
    const { ctx, calls } = pageContext(() => new Promise(() => {}));
    const first = ctx.getRosterLineupAssignments();
    assert.deepStrictEqual(JSON.parse(JSON.stringify(first)), {});
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, '/.netlify/functions/super-sage-lineup');
    assert.deepStrictEqual(calls[0].body.slots.map((s) => s.slotLabel), ['QB', 'RB', 'WR', 'TE', 'FLEX']);
  });

  await test('page: assignments are exactly the record (incl. PROVISIONAL), mapped back to roster names', async () => {
    const { ctx, box } = pageContext(async () => ({ ok: true, json: async () => siteBody }));
    ctx.getRosterLineupAssignments(); await tick(); await tick();
    const a = ctx.getRosterLineupAssignments();
    siteBody.record.slots.filter((s) => s.starter).forEach((s) => {
      const name = Object.keys(a).find((n) => a[n].call === 'start' && a[n].slot === s.slotLabel && s.starter.name.startsWith(n.split(' ')[0]));
      assert.ok(name, `${s.slotLabel} ${s.starter.name}`);
      if (s.hasValidatedEdge === false) assert.match(ctx.rosterLineupTag(a[name]), /PROVISIONAL/);
    });
    assert.strictEqual(Object.values(a).filter((x) => x.call === 'start').length, siteBody.record.slots.filter((s) => s.starter).length);
    assert.match(box.innerHTML, /Start: /); assert.ok(ctx.renders >= 1);
  });

  await test('page: an unavailable decision never falls back to local starters', async () => {
    const { ctx, box } = pageContext(async () => ({ ok: true, json: async () => ({ status: 'UNAVAILABLE', reason: 'WEEKLY_SAGE_UNAVAILABLE' }) }));
    ctx.getRosterLineupAssignments(); await tick(); await tick();
    assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.getRosterLineupAssignments())), {});
    assert.match(box.innerHTML, /unavailable/); assert.match(box.innerHTML, /No starters are recommended/);
  });

  await test('page: a superseded response cannot overwrite a newer request', async () => {
    let resolveOld; let n = 0;
    const { ctx } = pageContext(() => (n++ === 0 ? new Promise((r) => { resolveOld = r; }) : Promise.resolve({ ok: true, json: async () => siteBody })));
    ctx.getRosterLineupAssignments();
    ctx.getScoringFormat = () => 'ppr';
    ctx.getRosterLineupAssignments(); await tick(); await tick();
    resolveOld({ ok: true, json: async () => ({ status: 'UNAVAILABLE', reason: 'stale' }) }); await tick(); await tick();
    assert.strictEqual(ctx.superSageLineup.status, 'decided');
  });

  console.log('super-sage-one-authority.test.js: ' + passed + ' passed');
})().catch((e) => { console.error(e); process.exit(1); });
