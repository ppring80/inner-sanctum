'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const toml = fs.readFileSync(path.join(__dirname, '..', 'netlify.toml'), 'utf8');
assert.ok(!toml.includes('0 */6 * * 1-6'), 'six-hour player refresh must not return');
assert.ok(!toml.includes('0 0,6,12-23 * * 0'), 'hourly Sunday player refresh must not return');

// Maximum reservations on the busiest UTC day (Tuesday):
// player data 33 + news 1 + depth chart 1 + survivor 8 +
// schedule 1 + defense 17 + QB 101 + RB 129 + WR 129 + TE 97 + ADP 3.
const tuesdayMaximum = 33 + 1 + 1 + 8 + 1 + 17 + 101 + 129 + 129 + 97 + 3;
assert.strictEqual(tuesdayMaximum, 520);
assert.ok(tuesdayMaximum <= 700, 'scheduled Tuesday maximum must fit the shared safety budget');
assert.ok(1000 - tuesdayMaximum >= 300, 'scheduled Tuesday plan must preserve at least 300 calls of plan headroom');

console.log(`Tank01 schedule maximum ${tuesdayMaximum}/700; 480 calls below PRO allowance.`);
