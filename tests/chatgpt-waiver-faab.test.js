'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const mcp = require('../netlify/functions/chatgpt-mcp.js');
const source = fs.readFileSync(
  path.join(__dirname, '../netlify/functions/chatgpt-mcp.js'),
  'utf8'
);

const { faabPctToDollars, addFaabDollarGuidance } = mcp._test;

assert.strictEqual(faabPctToDollars(1, 200), 2);
assert.strictEqual(faabPctToDollars(3, 200), 6);
assert.strictEqual(faabPctToDollars(6, 200), 12);
assert.strictEqual(faabPctToDollars(8, 200), 16);
assert.strictEqual(faabPctToDollars(14, 200), 28);
assert.strictEqual(faabPctToDollars(20, 200), 40);
assert.strictEqual(faabPctToDollars(6, null), null);

const recommendation = addFaabDollarGuidance({
  name: 'Priority Stash',
  faab: {
    valuePct: 4,
    recommendedPct: 6,
    aggressivePct: 9
  }
}, 200);

assert.deepStrictEqual(
  {
    valueDollars: recommendation.faab.valueDollars,
    recommendedDollars: recommendation.faab.recommendedDollars,
    aggressiveDollars: recommendation.faab.aggressiveDollars,
    originalBudget: recommendation.faab.originalBudget
  },
  {
    valueDollars: 8,
    recommendedDollars: 12,
    aggressiveDollars: 18,
    originalBudget: 200
  }
);

assert.ok(source.includes('"get_waiver_recommendations"'));
assert.ok(source.includes('production six-band evidence model'));
assert.ok(source.includes('/.netlify/functions/waiver-recommendations'));
assert.ok(!source.includes('FAAB_MARKET_BANDS ='));

console.log('13 ChatGPT waiver/FAAB integration assertions passed, 0 failed.');
