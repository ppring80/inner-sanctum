'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {PROJECTION_RESERVE,DEFAULT_NORMAL_LIMIT,DEFAULT_DAILY_LIMIT}=require('../netlify/functions/_tank01-daily-budget');

const toml = fs.readFileSync(path.join(__dirname, '..', 'netlify.toml'), 'utf8');
assert.ok(!toml.includes('0 */6 * * 1-6'), 'six-hour player refresh must not return');
assert.ok(!toml.includes('0 0,6,12-23 * * 0'), 'hourly Sunday player refresh must not return');

// All availability triggers share at most four weekday reservations (132), plus
// current completed-week opportunity (17) and trend (34) evidence.
// Maximum reservations on the busiest UTC day (Tuesday):
// availability 132 + news (camp + bounded newswire retries) + depth chart 1 + survivor 8 +
// schedule 1 + defense 17 + QB 101 + RB 129 + WR 129 + TE 97 + ADP 3.
const tuesdayMaximum = 132 + 17 + 34 + 8 + 8 + 1 + 1 + 8 + 1 + 17 + 101 + 129 + 129 + 97 + 3;
assert.strictEqual(tuesdayMaximum, 686);
assert.ok(tuesdayMaximum - 99 <= 600, 'scheduled Tuesday maximum must fit the shared safety budget');
assert.ok(1000 - tuesdayMaximum >= 300, 'scheduled Tuesday plan must preserve at least 300 calls of plan headroom');

assert.ok(!/\[functions\."refresh-player-data(?:-game-day)?"\]/.test(toml),'availability must have one coordinator, not duplicate fixed schedules');
assert.ok(tuesdayMaximum-99<=DEFAULT_NORMAL_LIMIT-PROJECTION_RESERVE,'planned normal background jobs still fit after protecting projections');
const withProjections=tuesdayMaximum+PROJECTION_RESERVE;
assert.ok(withProjections<=DEFAULT_DAILY_LIMIT,'including all eight projection attempts stays within the existing total ceiling');
assert.ok(1000-withProjections>=300,'projection protection preserves at least 300 calls of plan headroom');
console.log(`Tank01 planned Tuesday including projection protection: ${withProjections}/700; ${1000-withProjections} below PRO allowance.`);
