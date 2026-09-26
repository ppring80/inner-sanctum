#!/usr/bin/env node
'use strict';

// scripts/record-connect-golden.js
//
// Records the Phase 0 desktop league-connection baselines FROM CURRENT
// PRODUCTION BEHAVIOR (mobile league-connect project). Nothing here is
// hand-written expectation: every golden value is observed by running the
// real connect-league.html page, league-connection.js, provider-adapters.js,
// team-context.js and the real Chrome-extension workers in the Phase 0 harness.
//
// Usage:
//   node scripts/record-connect-golden.js            # goldens + freeze manifest
//   node scripts/record-connect-golden.js --golden   # goldens only
//   node scripts/record-connect-golden.js --freeze   # freeze manifest only
//
// Every scenario is recorded twice and must produce identical output, so a
// nondeterministic value can never be frozen into a golden by accident.
//
// Re-recording IS a behavior change. Review the resulting diff and explain it
// in the pull request.

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const scenarios = require('../tests/helpers/connect-golden-scenarios');
const { computeFreezeState } = require('../tests/helpers/connect-source-blocks');

const REPO_ROOT = path.join(__dirname, '..');
const FREEZE_PATH = path.join(REPO_ROOT, 'tests', 'fixtures', 'desktop-connect-freeze.json');

const GOLDENS = [
  { file: 'cbs-receiver.golden.json', run: scenarios.runCbsReceiverScenarios },
  { file: 'espn-delivery.golden.json', run: scenarios.runEspnDeliveryScenarios },
  { file: 'cbs-listener.golden.json', run: scenarios.runCbsListenerScenarios },
  { file: 'connect-markup.golden.json', run: scenarios.runMarkupScenarios }
];

function currentCommit() {
  try {
    return childProcess.execSync('git rev-parse --short HEAD', { cwd: REPO_ROOT }).toString().trim();
  } catch (e) {
    return 'unknown';
  }
}

function write(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
  console.log('wrote ' + path.relative(REPO_ROOT, filePath));
}

async function recordGoldens() {
  for (const golden of GOLDENS) {
    const first = await golden.run();
    const second = await golden.run();
    assert.deepStrictEqual(second, first, golden.file + ' is not deterministic; refusing to record it.');
    write(path.join(scenarios.FIXTURE_DIR, golden.file), {
      recordedFrom: currentCommit(),
      note: 'Recorded by scripts/record-connect-golden.js from current production behavior. Do not edit by hand.',
      observations: first
    });
  }
}

function recordFreeze() {
  const state = computeFreezeState();
  write(FREEZE_PATH, {
    temporary: true,
    project: 'mobile league-connect (Phase 0 through Phase 1 merge)',
    purpose:
      'Makes any change to the proven desktop CBS/ESPN connection code explicit and reviewable during the mobile project. ' +
      'Not permanent architecture: permanent protection is the behavioral suites (cbs-receiver-golden, espn-delivery-golden, ' +
      'cbs-message-listener, connect-markup-baseline, extension-contract). Delete this manifest and ' +
      'tests/desktop-connect-freeze.test.js when the mobile project merges.',
    howToUpdate: 'Intentional change? Run `node scripts/record-connect-golden.js --freeze` and justify the diff in the PR.',
    recordedFrom: currentCommit(),
    files: state.files,
    blocks: state.blocks
  });
}

(async function main() {
  const args = process.argv.slice(2);
  const onlyGolden = args.includes('--golden');
  const onlyFreeze = args.includes('--freeze');
  if (!onlyFreeze) await recordGoldens();
  if (!onlyGolden) recordFreeze();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
