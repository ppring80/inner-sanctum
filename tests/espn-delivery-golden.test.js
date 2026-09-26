'use strict';

// tests/espn-delivery-golden.test.js
//
// Phase 0 (mobile league-connect): freezes the proven desktop ESPN delivery.
// Loads the REAL cbs-extension/service-worker-v050.js (which importScripts the
// CBS service-worker.js) with a recording chrome API, calls the real
// deliverEspnToSanctum(tabId, capture), captures the function handed to
// chrome.scripting.executeScript and runs it in the real connect-league page
// (as Chrome does for world "MAIN"). The observed behavior must equal the
// golden recorded from production (connect-golden/espn-delivery.golden.json).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const scenarios = require('./helpers/connect-golden-scenarios');

const golden = JSON.parse(
  fs.readFileSync(path.join(scenarios.FIXTURE_DIR, 'espn-delivery.golden.json'), 'utf8')
).observations;

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log('  ok - ' + name);
}

(async function run() {
  const observed = await scenarios.runEspnDeliveryScenarios();

  await test('delivery targets the Sanctum tab in the MAIN world with one payload arg', async () => {
    assert.deepStrictEqual(observed.firstDelivery.executeScript, {
      target: { tabId: scenarios.SANCTUM_TAB_ID },
      world: 'MAIN',
      argCount: 1
    });
  });

  await test('first delivery connects, second delivery updates', async () => {
    assert.deepStrictEqual(observed.firstDelivery.leagueConnectionCalls, [{ method: 'connect', provider: 'espn' }]);
    assert.deepStrictEqual(observed.secondDelivery.leagueConnectionCalls, [{ method: 'update', provider: 'espn' }]);
  });

  await test('stored ESPN connections deep-equal the recorded golden connections', async () => {
    assert.deepStrictEqual(observed.firstDelivery.storedConnection, golden.firstDelivery.storedConnection);
    assert.deepStrictEqual(observed.secondDelivery.storedConnection, golden.secondDelivery.storedConnection);
    assert.deepStrictEqual(observed.firstDelivery.returned, golden.firstDelivery.returned);
  });

  await test('existing ESPN connection fields and semantics are unchanged', async () => {
    const stored = observed.firstDelivery.storedConnection;
    assert.deepStrictEqual(Object.keys(stored).sort(), Object.keys(golden.firstDelivery.storedConnection).sort());
    assert.strictEqual(stored.connectionMode, 'browser-assisted');
    assert.strictEqual(stored.readOnly, true);
    assert.strictEqual(stored.private, true);
    assert.strictEqual(observed.firstDelivery.selectedProvider, 'espn');
    assert.strictEqual(observed.firstDelivery.activeConnectionId, golden.firstDelivery.activeConnectionId);
  });

  await test('refreshChatGptLinkIfNeeded("espn") is called', async () => {
    assert.deepStrictEqual(observed.firstDelivery.refreshChatGptLinkCalls.map((c) => c.provider), ['espn']);
    assert.deepStrictEqual(observed.secondDelivery.refreshChatGptLinkCalls.map((c) => c.provider), ['espn']);
  });

  await test('#espnResult success UI is unchanged', async () => {
    assert.deepStrictEqual(observed.firstDelivery.espnResult, golden.firstDelivery.espnResult);
    assert.strictEqual(observed.firstDelivery.espnResult.className, 'result-box success show');
  });

  await test('incomplete captures are rejected in the page with the same message', async () => {
    assert.deepStrictEqual(observed.incompleteRoster, golden.incompleteRoster);
    assert.strictEqual(observed.incompleteRoster.thrownMessage, 'Incomplete ESPN league data was received.');
  });

  await test('entire observation equals the golden (catch-all)', async () => {
    assert.deepStrictEqual(observed, golden);
  });

  console.log('espn-delivery-golden.test.js: ' + passed + ' passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
