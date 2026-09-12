// tests/dispatches-no-available-for-you.test.js
//
// Regression coverage for the Free Agents extraction: proves Dispatches no
// longer contains the "Available For You" waiver tab/board, and that no
// stale filterType('waiver') navigation was left behind. Companion to
// tests/free-agents-board.test.js, which proves the moved functionality is
// genuinely present and working on the new standalone page.
//
// Run: node tests/dispatches-no-available-for-you.test.js

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'dispatches.html'), 'utf8');

let passed = 0;
let failed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    failed += 1;
    failures.push(name + ' :: ' + (err && err.message ? err.message : err));
  }
}

test('Dispatches no longer names "Available For You" anywhere', () => {
  assert.ok(!html.includes('Available For You'), 'the old product name must not appear in dispatches.html');
});

test('Dispatches no longer has a waiver tab or waiver view panel', () => {
  assert.ok(!html.includes('data-type="waiver"'), 'the waiver type-tab must be removed');
  assert.ok(!html.includes('id="view-waiver"'), 'the waiver view panel must be removed');
  assert.ok(!html.includes('id="waiverRoot"'), 'the waiver board root container must be removed');
});

test('Dispatches no longer defines the moved board-rendering functions', () => {
  [
    'function renderWaivers', 'function renderDecisionBoard', 'function rowHtml',
    'function sortRows', 'function positionMatch', 'function setPositionFilter',
    'function setBoardSort', 'function toggleDetail', 'function rosterImpactCell',
    'function trendCell', 'function renderWaiverError', 'function setWaiverSnapshot',
    'async function loadWaivers', 'function retryWaivers',
  ].forEach((needle) => {
    assert.ok(!html.includes(needle), needle + ' should have moved to free-agents.html, not remain in dispatches.html');
  });
});

test('Dispatches has no stale filterType(\'waiver\') navigation or dead waiver branch', () => {
  assert.ok(!html.includes("filterType('waiver')"), 'no control should still try to open the removed waiver tab');
  assert.ok(!html.includes("loadWaivers()"), 'nothing in dispatches.html should still call the (now-removed) loadWaivers function');
  assert.ok(!/if\(type===.waiver.\)/.test(html), 'filterType() must not retain a dead waiver-specific branch');
});

test('Dispatches\' former waiver entry points now navigate to /free-agents', () => {
  assert.ok(html.includes('href="/free-agents"'), 'at least one real link to the new Free Agents page must exist');
});

test('Dispatches retains exactly its four intended tabs: This Week, Risers & Fallers, Podcast, Camp Archive', () => {
  const types = [...html.matchAll(/data-type="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(types, ['week', 'trend', 'pod', 'camp']);
});

console.log('');
console.log('dispatches-no-available-for-you.test.js: ' + passed + '/' + (passed + failed) + ' passed');
if (failed > 0) {
  failures.forEach((f) => console.error('FAIL:', f));
  process.exitCode = 1;
}
