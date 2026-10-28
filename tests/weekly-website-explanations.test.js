'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../weekly.html'), 'utf8');
const start = html.indexOf('function weeklyDisplayExplanation(row) {');
const end = html.indexOf('function mapWeeklyRowToProfileModel(', start);
assert(start > 0 && end > start, 'Display-only helper must exist before profile presenter');
const sandbox = { getScoringFormat: () => 'half' };
vm.runInNewContext(html.slice(start, end), sandbox);
const row = {
  playerID: 'fixture-1', name: 'Fixture Back', pos: 'RB', positionRank: 15,
  providerProjectedPoints: 12.41, matchup: 'Negative', opp: 'WSH',
  injury: 'questionable', eligibleForWeeklyRanking: true,
  sageTake: 'Backfield role change: teammates unavailable. The share is not verified. Do not use the old rank alone to recommend dropping this player. A difficult matchup is driving the ranking despite strong production. Solid start.'
};
const before = JSON.stringify(row);
const result = sandbox.weeklyDisplayExplanation(row);
assert(result.includes('RB15') && result.includes('12.4 projected half points'));
assert(result.includes('Difficult matchup against WSH'));
assert(result.includes('Questionable; confirm status before kickoff.'));
assert(!/drop|backfield role|driving the ranking|solid start/i.test(result));
assert.equal(JSON.stringify(row), before, 'Formatting must not mutate decision evidence');
const supported = { ...row, sageTake: 'Verified direct role change: more carries after starter ruled out.' };
assert.equal(sandbox.weeklyDisplayExplanation(supported), supported.sageTake, 'Supported specific prose survives');
const xss = sandbox.weeklyEscapeHtml('<img src=x onerror="bad">&');
assert.equal(xss, '&lt;img src=x onerror=&quot;bad&quot;&gt;&amp;');
assert(html.includes('insight: weeklyDisplayExplanation(row)'), 'Profile uses display-only prose');
assert(html.includes('weeklyEscapeHtml(verdictText)'), 'Table escapes display prose');
assert(html.includes('? weeklyDisplayExplanation(p)'), 'Table uses display-only prose');
console.log('Website weekly explanation display checks passed');
