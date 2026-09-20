'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'weekly.html'), 'utf8');

assert.ok(source.includes('function injuryPillHtml(code)'), 'Weekly rows must render live injury designations.');
assert.ok(source.includes("questionable: 'Q'"), 'Questionable players must receive a visible Q badge.');
assert.ok(source.includes('injuryPillHtml(p.injury)'), 'The injury badge must be included in the player cell.');

assert.match(
  source,
  /href="\/free-agents">🎯 Free Agents &amp; FAAB<\/a>/,
  'Weekly Rankings must expose the completed Free Agents and FAAB tool directly'
);

assert.match(
  source,
  /positionGroup = \{ QB: 0, RB: 0, WR: 0, TE: 0, K: 1, DEF: 1 \}/,
  'ALL view must keep offensive positions ahead of K and DEF'
);

assert.ok(
  source.includes("snapshotUsesProjection ? 'Top Projected' : 'Top SAGE Signal'"),
  'Week Snapshot must distinguish projections from SAGE scores'
);

assert.ok(
  !source.includes("topProjected.sageScore.toFixed(1) +\n          ' pts'"),
  'SAGE score must never be labeled as fantasy points'
);

assert.ok(
  source.includes("(snapshotUsesProjection ? ' pts' : ' SAGE')"),
  'Week Snapshot must label each numeric scale truthfully'
);

assert.ok(
  source.includes("return entry.matchup.label || entry.matchup.signal || null;"),
  'Week 2 matchup evidence objects must resolve to their customer-facing label'
);

assert.ok(
  source.includes('matchup: weeklyMatchupLabel(entry)'),
  'Weekly rows must never stringify a matchup evidence object'
);

assert.ok(
  source.includes('detectConnectedEspnScoring(connection) ||'),
  'Weekly must repair ESPN scoring format from the saved reception rule before trusting stale metadata'
);

assert.ok(
  source.includes("if (Math.abs(points - 0.5) < 0.001) return 'half-ppr';"),
  'Weekly must recognize ESPN half-PPR reception scoring'
);

console.log('weekly-page-closeout.test.js passed');
