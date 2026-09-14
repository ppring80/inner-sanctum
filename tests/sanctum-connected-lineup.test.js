'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../sanctum.html'), 'utf8');

function extractFunction(name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' must exist');
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('Could not extract ' + name);
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(extractFunction('normalizeConnectedRoster'), sandbox);
vm.runInContext(extractFunction('connectedRosterCounts'), sandbox);

const espn = {
  provider: 'espn',
  roster: [
    { name: 'Josh Allen', position: 'QB', nflTeam: 'BUF' },
    { name: 'Christian McCaffrey', position: 'RB', nflTeam: 'SF' },
    { displayName: 'Jake Elliott', position: 'PK', team: 'PHI' },
    { name: 'Houston', position: 'D/ST', nflTeam: 'HOU' },
    { name: 'Ignore IDP', position: 'LB', nflTeam: 'BAL' }
  ],
  lineupConstruction: {
    QB:1, RB:2, WR:2, TE:1, FLEX:2, SUPERFLEX:0, K:1, DEF:1, BENCH:6
  }
};

assert.deepStrictEqual(
  JSON.parse(JSON.stringify(sandbox.normalizeConnectedRoster(espn))),
  [
    { name:'Josh Allen', pos:'QB', team:'BUF' },
    { name:'Christian McCaffrey', pos:'RB', team:'SF' },
    { name:'Jake Elliott', pos:'K', team:'PHI' },
    { name:'Houston', pos:'DEF', team:'HOU' }
  ]
);

assert.deepStrictEqual(
  JSON.parse(JSON.stringify(sandbox.connectedRosterCounts(espn))),
  { QB:1, RB:2, WR:2, TE:1, FLEX:2, RECFLEX:0, SFLEX:0, K:1, DEF:1, BENCH:6 }
);

assert.strictEqual(sandbox.normalizeConnectedRoster(null).length, 0);
assert.strictEqual(sandbox.connectedRosterCounts({ lineupConstruction:{} }), null);

assert.ok(source.includes('var connection = LeagueConnection.getActiveConnection();'));
assert.ok(source.includes("note.textContent = '✓ Auto-filled from ' + provider;"));
assert.ok(source.includes('applyConnectedLeagueLineup();'));
assert.ok(source.includes("window.addEventListener('innerSanctum:leagueContextChanged'"));
assert.ok(source.includes('autoFillFromSleeper();'), 'existing slot assignment engine must be reused');
assert.ok(!extractFunction('applyConnectedLeagueLineup').includes('fetch('), 'adapter must use stored connection data only');

assert.ok(source.includes('max-width: 920px;'), 'Sanctum workspace must use the wider centered layout');
assert.ok(source.includes('margin: 10px auto 0;'), 'lineup advisor must be horizontally centered');
assert.ok(source.includes('.is-team-context-bar { display: none !important; }'), 'misplaced shared context bar must be suppressed on Sanctum');
assert.ok(source.includes('id="lineupTeamContext"'), 'active team context must live inside the advisor');
assert.ok(source.includes("updateConnectedLeaguePresentation(connection, provider, players.length);"), 'connected team presentation must update with roster data');
assert.ok(source.includes("banner.classList.remove('show')"), 'duplicate roster-pill banner must be collapsed for connected leagues');
assert.ok(extractFunction('applyConnectedLeagueLineup').includes('autoFillFromSleeper();'), 'presentation cleanup must preserve auto-fill');

console.log('sanctum-connected-lineup.test.js passed');
