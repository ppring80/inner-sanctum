const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'team-context.js'), 'utf8');

assert.ok(
  source.includes('function resolveActiveEspnTeamAutomatically()'),
  'ESPN team context should resolve automatically from safe identity hints'
);

assert.ok(
  source.includes('ESPN_TEAM_PREF_KEY'),
  'resolved ESPN team identity should persist independently of disconnectable league state'
);

assert.ok(
  source.includes('CHATGPT_LINK_STORAGE_KEY'),
  'an existing ChatGPT league link may safely recover the matching ESPN team identity'
);

assert.ok(
  source.includes('function inferEspnTeamFromRoster(connection)'),
  'a high-confidence saved Weekly roster fingerprint should be available as an automatic fallback'
);

assert.ok(
  source.includes('best.matches < 3'),
  'roster inference must require multiple matching players before resolving a team'
);

assert.ok(
  !source.includes('renderEspnTeamStep'),
  'the removed customer-facing ESPN team-selection step must not return'
);

assert.ok(
  !source.includes('innerSanctumEspnTeamSelect'),
  'team-context must not render an ESPN team dropdown'
);

assert.ok(
  !source.includes('MutationObserver'),
  'automatic ESPN resolution should not depend on restoring a removed selector after rerenders'
);

const lineupMatch = source.match(/function normalizeEspnLineup\(settings\) \{[\s\S]*?\n  \}/);
assert.ok(lineupMatch, 'ESPN lineup normalization must consume the captured top-level settings object');
const context = {};
vm.createContext(context);
vm.runInContext(lineupMatch[0] + '\nthis.normalizeEspnLineup = normalizeEspnLineup;', context);
const lineup = context.normalizeEspnLineup({
  rosterSettings: {
    lineupSlotCounts: { 0: 1, 2: 2, 4: 2, 6: 1, 23: 2, 17: 1, 16: 1, 20: 4 }
  }
});
assert.deepStrictEqual(JSON.parse(JSON.stringify(lineup)), {
  QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, SUPERFLEX: 0,
  K: 1, DEF: 1, BENCH: 4, IR: 0
});
assert.ok(
  source.includes('lineupConstruction: normalizeEspnLineup(connection?.settings)'),
  'team context must pass the real top-level ESPN settings into lineup normalization'
);

console.log('team-context-connect-flow.test.js passed');
