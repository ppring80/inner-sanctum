'use strict';

// tests/desktop-connect-freeze.test.js
//
// TEMPORARY — mobile league-connect project only (Phase 0 through Phase 1).
// Delete this file and tests/fixtures/desktop-connect-freeze.json when the
// mobile project merges.
//
// Makes any change to the proven desktop CBS/ESPN connection code EXPLICIT and
// REVIEWABLE while mobile work happens beside it. It does not forbid change:
// an intentional change re-records the manifest in the same PR
//   node scripts/record-connect-golden.js --freeze
// and the PR explains why. Permanent protection is behavioral:
// cbs-receiver-golden, espn-delivery-golden, cbs-message-listener,
// connect-markup-baseline and extension-contract.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { computeFreezeState } = require('./helpers/connect-source-blocks');

const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'desktop-connect-freeze.json'), 'utf8')
);
const current = computeFreezeState();
const HOW = 'Intentional? Run `node scripts/record-connect-golden.js --freeze` and justify the change in the PR.';

const problems = [];

Object.keys(manifest.files).forEach((file) => {
  if (!(file in current.files)) problems.push('protected file removed: ' + file);
  else if (current.files[file] !== manifest.files[file]) problems.push('protected file changed: ' + file);
});
Object.keys(current.files).forEach((file) => {
  if (!(file in manifest.files)) problems.push('new file under a protected path: ' + file);
});
Object.keys(manifest.blocks).forEach((name) => {
  const now = current.blocks[name];
  if (!now) problems.push('protected connect-league.html block missing: ' + name);
  else if (now.sha256 !== manifest.blocks[name].sha256) problems.push('protected connect-league.html block changed: ' + name);
});

assert.strictEqual(manifest.temporary, true, 'the freeze manifest must stay marked temporary');
assert.ok(Object.keys(manifest.files).some((f) => f.startsWith('cbs-extension/')), 'cbs-extension/** is covered');
['provider-adapters.js', 'league-connection.js', 'netlify/functions/league-snapshot.js'].forEach((f) => {
  assert.ok(f in manifest.files, f + ' is covered');
});
['startCbsConnect', 'receiveCbsConnection', 'cbsMessageListener', 'renderProviderForm', 'buildCbsForm', 'buildEspnForm']
  .forEach((b) => assert.ok(b in manifest.blocks, b + ' is covered'));

if (problems.length) {
  console.error('Desktop league-connect freeze (temporary, mobile project):');
  problems.forEach((p) => console.error('  - ' + p));
  console.error(HOW);
  process.exit(1);
}

console.log(
  'desktop-connect-freeze.test.js: PASS (' + Object.keys(manifest.files).length + ' files, ' +
  Object.keys(manifest.blocks).length + ' connect-league.html blocks unchanged since ' + manifest.recordedFrom + ')'
);
