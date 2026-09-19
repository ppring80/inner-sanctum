#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  POSITIONS,
  evaluateAllPositions
} = require('../netlify/functions/weekly-sage-ranking-guardrails');

const inputArg = process.argv[2];

if (!inputArg) {
  console.error('Usage: npm run qa:weekly-rankings -- <weekly-ranking-input.json>');
  process.exit(2);
}

const inputPath = path.resolve(process.cwd(), inputArg);
let payload;

try {
  payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
} catch (error) {
  console.error(`Unable to read weekly ranking QA input: ${error.message}`);
  process.exit(2);
}

const result = evaluateAllPositions(payload);
const summary = POSITIONS.map(position => {
  const report = result.reports[position];
  return {
    position,
    status: report.passed ? 'PASS' : 'FAIL',
    benchmarkSources: report.sources.length,
    critical: report.critical,
    review: report.review
  };
});

console.table(summary);

POSITIONS.forEach(position => {
  const report = result.reports[position];
  if (!report.sourceCoveragePassed) {
    console.error(
      `${position}: requires at least ${result.policy.minimumBenchmarkSources} benchmark sources.`
    );
  }
  report.outliers.forEach(item => {
    const rank = item.sageRank === null ? 'missing' : item.sageRank;
    console.error(
      `${item.severity.toUpperCase()} ${position} ${item.player}: SAGE ${rank}, ` +
      `benchmark ${item.consensusRank ?? 'n/a'} — ${item.reasons.join(' ')}`
    );
  });
});

if (!result.passed) {
  console.error('\nWeekly ranking QA FAILED. Resolve or explicitly document every exception before release.');
  process.exit(1);
}

console.log('\nWeekly ranking QA PASSED for QB, RB, WR, TE, K, and DEF.');
