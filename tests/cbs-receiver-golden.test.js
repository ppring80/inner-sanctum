'use strict';

// tests/cbs-receiver-golden.test.js
//
// Phase 0 (mobile league-connect): freezes the proven desktop CBS receiver.
// Drives the REAL window.receiveCbsConnection(captured) in connect-league.html
// through the Phase 0 harness and requires the observed behavior to equal the
// golden recorded from production (tests/fixtures/connect-golden/
// cbs-receiver.golden.json). Re-record only for an intentional change:
//   node scripts/record-connect-golden.js --golden

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const scenarios = require('./helpers/connect-golden-scenarios');

const golden = JSON.parse(
  fs.readFileSync(path.join(scenarios.FIXTURE_DIR, 'cbs-receiver.golden.json'), 'utf8')
).observations;

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log('  ok - ' + name);
}

(async function run() {
  const observed = await scenarios.runCbsReceiverScenarios();

  await test('first sync uses LeagueConnection.connect("cbs")', async () => {
    assert.deepStrictEqual(observed.firstSync.leagueConnectionCalls, [{ method: 'connect', provider: 'cbs' }]);
  });

  await test('second sync uses LeagueConnection.update("cbs")', async () => {
    assert.deepStrictEqual(observed.secondSync.leagueConnectionCalls, [{ method: 'update', provider: 'cbs' }]);
  });

  await test('stored connections deep-equal the recorded golden connections', async () => {
    assert.deepStrictEqual(observed.firstSync.storedConnection, golden.firstSync.storedConnection);
    assert.deepStrictEqual(observed.secondSync.storedConnection, golden.secondSync.storedConnection);
    assert.deepStrictEqual(observed.firstSync.returned, golden.firstSync.returned);
    assert.strictEqual(observed.firstSync.activeConnectionId, golden.firstSync.activeConnectionId);
  });

  await test('connectionMode remains "browser-assisted" and read-only', async () => {
    assert.strictEqual(observed.firstSync.storedConnection.connectionMode, 'browser-assisted');
    assert.strictEqual(observed.firstSync.storedConnection.readOnly, true);
  });

  await test('defense identity normalization is unchanged', async () => {
    const defense = observed.firstSync.storedConnection.roster.find((p) => p.position === 'DST');
    const goldenDefense = golden.firstSync.storedConnection.roster.find((p) => p.position === 'DST');
    assert.deepStrictEqual(defense, goldenDefense);
    assert.strictEqual(defense.name, goldenDefense.name);
  });

  await test('refreshChatGptLinkIfNeeded("cbs") is called and awaited before the receiver resolves', async () => {
    assert.deepStrictEqual(
      observed.firstSync.refreshChatGptLinkCalls.map((c) => c.provider),
      ['cbs']
    );
    assert.strictEqual(observed.firstSync.refreshSettledBeforeReceiverResolved, true);
    assert.strictEqual(observed.secondSync.refreshSettledBeforeReceiverResolved, true);
  });

  await test('#cbsResult success behavior is unchanged', async () => {
    assert.deepStrictEqual(observed.firstSync.cbsResult, golden.firstSync.cbsResult);
    assert.deepStrictEqual(observed.secondSync.cbsResult, golden.secondSync.cbsResult);
    assert.strictEqual(observed.firstSync.cbsResult.className, 'result-box success show');
  });

  await test('linked ChatGPT snapshot refresh is unchanged', async () => {
    assert.deepStrictEqual(observed.withChatGptLink, golden.withChatGptLink);
  });

  await test('validation failures keep their exact messages and UI', async () => {
    assert.deepStrictEqual(observed.validation, golden.validation);
    assert.strictEqual(observed.validation.missingLeague.thrownMessage, 'CBS league or team identity is missing.');
    assert.strictEqual(observed.validation.missingTeam.thrownMessage, 'CBS league or team identity is missing.');
    assert.strictEqual(observed.validation.rosterNotArray.thrownMessage, 'CBS roster data is missing.');
    Object.values(observed.validation).forEach((failure) => {
      assert.strictEqual(failure.cbsResult.className, 'result-box error show');
      assert.strictEqual(failure.storedState, null, 'a rejected capture must not persist anything');
    });
  });

  await test('entire observation equals the golden (catch-all)', async () => {
    assert.deepStrictEqual(observed, golden);
  });

  console.log('cbs-receiver-golden.test.js: ' + passed + ' passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
