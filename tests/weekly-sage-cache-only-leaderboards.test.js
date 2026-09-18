'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const functionsDir = path.join(__dirname, '..', 'netlify', 'functions');

for (const position of ['qb', 'wr', 'te']) {
  const source = fs.readFileSync(
    path.join(functionsDir, `weekly-sage-${position}-leaderboard.js`),
    'utf8'
  );

  assert.ok(source.includes('readCachedWeeklySchedule'));
  assert.ok(!source.includes(`/.netlify/functions/\${SCHEDULE_FUNCTION}?`));
}

const rbConfidence = fs.readFileSync(
  path.join(functionsDir, 'weekly-sage-rb-confidence.js'),
  'utf8'
);

assert.ok(!rbConfidence.includes('require(\n  "./weekly-sage-player-season"'));
assert.ok(rbConfidence.includes('live player-season rebuilding is disabled'));

const playerMatchup = fs.readFileSync(
  path.join(functionsDir, 'weekly-sage-player-matchup.js'),
  'utf8'
);

assert.ok(playerMatchup.includes('readCachedWeeklySchedule'));
assert.ok(!playerMatchup.includes('/.netlify/functions/weekly-sage-schedule'));

console.log('10 Weekly SAGE cache-only leaderboard assertions passed, 0 failed.');
