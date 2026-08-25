#!/usr/bin/env node
// scripts/run-tests.js
//
// Unified local regression gate for the SAGE pillar test suites plus
// the giveaway redemption suites.
//
// Runs all ten suites below, in order, even if an earlier one fails —
// so a single `npm test` run surfaces every suite's result at once
// rather than stopping at the first failure. Each suite's own
// stdout/stderr is preserved exactly as if it were run directly.
//
// Built-in Node only (child_process) — no test framework, no new
// dependency. Individual suites remain independently runnable exactly
// as before, e.g.:
//   node tests/draft-market-profile.test.js
//
// This script does not modify any test file or any production code.
//
// Exit code: 0 if all suites passed, 1 if any suite failed.

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');

const SUITES = [
  'tests/draft-market-profile.test.js',
  'tests/draft-opportunity-profile.test.js',
  'tests/refresh-opportunity-intel-scheduled.test.js',
  'tests/draft-scarcity-profile.test.js',
  'tests/draft-context-profile.test.js',
  'tests/draft-sage-synthesis.test.js',
  'tests/redeem-giveaway-code.test.js',
  'tests/weekly-oauth-session.test.js',
  'tests/sage-recommend.test.js',
  'tests/draft-sage-integration.test.js',
  'tests/draft-roster-advisory.test.js',
  'tests/draft-command-center-keepers.test.js',
  'tests/draft-command-center-mock.test.js',
  'tests/draft-command-center-reset.test.js',
  'tests/decision-engine.test.js',
  'tests/draft-command-center-board.test.js',
];

const results = [];

SUITES.forEach((relPath) => {
  const fullPath = path.join(REPO_ROOT, relPath);
  console.log('\n=== ' + relPath + ' ===');

  const result = spawnSync(process.execPath, [fullPath], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });

  results.push({
    suite: relPath,
    passed: result.status === 0,
    status: result.status,
  });
});

console.log('\n' + '='.repeat(60));
console.log('REGRESSION GATE SUMMARY');
console.log('='.repeat(60));

results.forEach((r) => {
  console.log('  [' + (r.passed ? 'PASS' : 'FAIL') + ']  ' + r.suite);
});

const passedCount = results.filter((r) => r.passed).length;
const anyFailed = passedCount < results.length;

console.log('\n' + passedCount + '/' + results.length + ' suites passed');

if (anyFailed) {
  console.log('\nRegression gate FAILED.');
  process.exit(1);
} else {
  console.log('\nRegression gate PASSED.');
  process.exit(0);
}
