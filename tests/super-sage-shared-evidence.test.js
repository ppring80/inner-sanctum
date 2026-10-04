'use strict';

// tests/super-sage-shared-evidence.test.js
//
// Lineup, Compare Players and Player Profile see the SAME observed-opportunity
// evidence through the SAME temporally guarded reader, with the same
// provenance (weeks actually observed + real kickoff cutoff). An unavailable
// snapshot is exposed as a gap, never rebuilt locally.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createFakeBlobs, loadFunctionWithFakeBlobs } = require('./helpers/fake-netlify-blobs.js');
const { easternToIso } = require('../netlify/functions/_super-sage-kickoff.js');

const DIR = path.join(__dirname, 'fixtures', 'super-sage-week4');
const RANK = JSON.parse(fs.readFileSync(path.join(DIR, 'production-rankings.json'), 'utf8'));
const OPP = JSON.parse(fs.readFileSync(path.join(DIR, 'production-opportunity.json'), 'utf8'));
const ROSTER = JSON.parse(fs.readFileSync(path.join(DIR, 'roster.json'), 'utf8'));

function schedule() {
  const games = new Map();
  Object.values(RANK.positions).flat().forEach((r) => {
    if (!r.gameID || games.has(r.gameID)) return;
    const [away, home] = r.gameID.split('_')[1].split('@');
    games.set(r.gameID, { gameID: r.gameID, gameDate: r.gameDate, gameTime: r.gameTime, gameTime_epoch: String(Date.parse(easternToIso(r.gameDate, r.gameTime)) / 1000), gameStatus: 'Scheduled', away, home });
  });
  games.set('20261001_PIT@CLE', { gameID: '20261001_PIT@CLE', gameDate: '20261001', gameTime: '8:15p', gameTime_epoch: String(Date.parse('2026-10-02T00:15:00Z') / 1000), away: 'PIT', home: 'CLE' });
  return { evidenceType: 'weekly-sage-schedule', season: '2026', week: 4, seasonType: 'reg', games: [...games.values()] };
}

let passed = 0;
async function test(name, fn) { await fn(); passed += 1; console.log('  ok - ' + name); }
// Opportunity component nearest to an object that names the player.
const findOpp = (obj, name) => {
  let found = null;
  (function walk(o, owner) {
    if (found || !o || typeof o !== 'object') return;
    const here = (o.name === name || o.player === name || (o.identity && o.identity.name === name)) ? name : owner;
    if (here === name && o.components && o.components.opportunity && o.components.opportunity.opportunities) { found = o.components.opportunity; return; }
    Object.values(o).forEach((v) => walk(v, here));
  })(obj, null);
  return found;
};

(async () => {
  const blobs = createFakeBlobs();
  await blobs.module.getStore({ name: 'opportunity-intel' }).setJSON('latest', OPP);
  await blobs.module.getStore({ name: 'weekly-sage-schedule' }).setJSON('week:2026:4:reg', schedule());
  const mcp = loadFunctionWithFakeBlobs('netlify/functions/chatgpt-mcp.js', blobs);
  const oldFetch = global.fetch;
  const opportunityHttp = [];
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/opportunity-intel')) opportunityHttp.push(u);
    return u.includes('weekly-sage-rankings') ? { ok: true, status: 200, json: async () => RANK } : { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    const server = mcp._test.buildServer(new Request('https://fixture.invalid/.netlify/functions/chatgpt-mcp'), {
      snapshot: { provider: 'cbs', scoringFormat: 'half-ppr', league: { season: 2026, teamCount: 12 },
        roster: ROSTER.roster.map((p) => ({ name: p.name, position: p.position, status: p.rosterStatus || null })),
        settings: { lineupSlots: [['QB', 1], ['RB', 2], ['WR', 2], ['TE', 1], ['FLEX', 2]].map(([slot, count]) => ({ slot, count })) } }
    });
    const cmp = await server._registeredTools.compare_players.handler({ players: ['Blake Corum', 'Courtland Sutton'], season: 2026, week: 4, scoring: 'half' });
    const prof = await server._registeredTools.get_player_profile.handler({ player: 'Blake Corum', season: 2026, week: 4, scoring: 'half' });
    const lineup = await server._registeredTools.get_lineup_recommendation.handler({ season: 2026, week: 4 });

    await test('Compare and Profile read the shared guarded snapshot (no per-player HTTP)', async () => {
      assert.ok(!cmp.isError && !prof.isError);
      assert.deepStrictEqual(opportunityHttp, [], 'no opportunity-intel HTTP calls');
      const c = findOpp(cmp.structuredContent, 'Blake Corum'), p = findOpp(prof.structuredContent, 'Blake Corum');
      assert.ok(c && p, 'opportunity evidence attached in both tools');
      [c, p].forEach((o) => {
        assert.deepStrictEqual(o.provenance.weeksIncluded, [1, 2, 3]);
        assert.strictEqual(o.provenance.temporalAuthority, '_rawGames[].week and gameID date');
        assert.strictEqual(o.provenance.decisionCutoff, '2026-10-02T00:15:00.000Z', 'real kickoff cutoff');
      });
    });

    await test('Lineup, Compare and Profile see the same observed values and provenance', async () => {
      assert.strictEqual(lineup.structuredContent.superSage.evidenceStatus.opportunity.status, 'AVAILABLE');
      const c = findOpp(cmp.structuredContent, 'Blake Corum'), p = findOpp(prof.structuredContent, 'Blake Corum');
      // The lineup record's packet for the same player (via the website-equivalent record in MCP's structured decision is summary-only, so read the shared service directly).
      const { decideSharedLineup } = require('../netlify/functions/_super-sage-lineup-service.js');
      const r = await decideSharedLineup({ rankings: RANK, roster: ROSTER.roster.map((x) => ({ name: x.name, eligiblePositions: [x.position], rosterStatus: x.rosterStatus || null })), provider: 'cbs', slots: ROSTER.slots, season: 2026, week: 4, scoring: 'half', schedule: schedule(), opportunityStore: blobs.module.getStore({ name: 'opportunity-intel' }), now: new Date('2026-10-01T18:00:00Z') });
      const corum = [...r.record.slots.map((s) => s.starter), ...r.record.bench].find((x) => x && x.name === 'Blake Corum');
      assert.strictEqual(corum.observedOpportunity.avgLast3, c.opportunities.avgLast3);
      assert.strictEqual(c.opportunities.avgLast3, p.opportunities.avgLast3);
      assert.deepStrictEqual(corum.observedOpportunity.provenance.weeksIncluded, c.provenance.weeksIncluded);
      assert.strictEqual(corum.observedOpportunity.provenance.decisionCutoff, c.provenance.decisionCutoff);
    });

    await test('a temporally unsafe snapshot is exposed as a gap in Compare, never used', async () => {
      const bad = JSON.parse(JSON.stringify(OPP));
      bad.records['blake corum|RB']._rawGames.push({ week: 4, gameID: '20261004_LAR@PHI', carries: 20, targets: 3, opportunities: 23 });
      const blobs2 = createFakeBlobs();
      await blobs2.module.getStore({ name: 'opportunity-intel' }).setJSON('latest', bad);
      const mcp2 = loadFunctionWithFakeBlobs('netlify/functions/chatgpt-mcp.js', blobs2);
      const s2 = mcp2._test.buildServer(new Request('https://fixture.invalid/.netlify/functions/chatgpt-mcp'), {});
      const r2 = await s2._registeredTools.compare_players.handler({ players: ['Blake Corum', 'Courtland Sutton'], season: 2026, week: 4, scoring: 'half' });
      assert.ok(!r2.isError);
      assert.strictEqual(findOpp(r2.structuredContent, 'Blake Corum'), null, 'leaking snapshot must not be attached');
    });
  } finally { global.fetch = oldFetch; }
  console.log('super-sage-shared-evidence.test.js: ' + passed + ' passed');
})().catch((e) => { console.error(e); process.exit(1); });
