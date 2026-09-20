'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'weekly.html'), 'utf8');

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

console.log('weekly-page-closeout.test.js passed');
