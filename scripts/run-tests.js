#!/usr/bin/env node
// scripts/run-tests.js
//
// Canonical Inner Sanctum regression gate.
//
// Every JavaScript test file in /tests whose name ends in `.test.js`
// is part of this gate automatically. This keeps local `npm test` and
// GitHub Actions aligned and prevents new regression suites from being
// added to the repository without being exercised by the canonical
// test command.
//
// Diagnostic/reporting scripts that do not end in `.test.js` (for
// example sage-rb-schedule-board.js) are intentionally excluded from
// the pass/fail regression gate and can still be run separately.
//
// All suites run even if an earlier one fails so one execution surfaces
// the complete regression picture. Each suite's stdout/stderr is
// preserved exactly as if it were run directly.
//
// tests/test-runtime-bootstrap.js is preloaded into each child process.
// It supplies test-only compatibility for browser-only globals and auth
// dependencies that production pages/functions provide outside the unit
// harness. It is never loaded by Netlify or customer-facing pages.
//
// Exit code: 0 if every suite passed, 1 if any suite failed.

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const TESTS_DIR = path.join(REPO_ROOT, 'tests');
const TEST_BOOTSTRAP = path.join(TESTS_DIR, 'test-runtime-bootstrap.js');

const SUITES = fs
  .readdirSync(TESTS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.test.js'))
  .map((entry) => `tests/${entry.name}`)
  .sort();

if (SUITES.length === 0) {
  console.error('No regression test suites found in tests/*.test.js');
  process.exit(1);
}

if (!fs.existsSync(TEST_BOOTSTRAP)) {
  console.error('Missing test bootstrap: ' + TEST_BOOTSTRAP);
  process.exit(1);
}

const results = [];

SUITES.forEach((relPath) => {
  const fullPath = path.join(REPO_ROOT, relPath);
  console.log('\n=== ' + relPath + ' ===');

  const result = spawnSync(
    process.execPath,
    ['-r', TEST_BOOTSTRAP, fullPath],
    {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    }
  );

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
