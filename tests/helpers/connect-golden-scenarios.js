'use strict';

// tests/helpers/connect-golden-scenarios.js
//
// TEST-ONLY. Scenario runners that drive the REAL production connection code
// through tests/helpers/connect-page-harness.js and return plain-JSON
// observations. scripts/record-connect-golden.js writes these observations to
// tests/fixtures/connect-golden/*.golden.json; the golden tests re-run the same
// scenarios and require identical observations.

const fs = require('fs');
const path = require('path');
const {
  loadConnectPage,
  loadExtensionWorker,
  runInjectedFunction,
  normalizeVolatile,
  spyLeagueConnection
} = require('./connect-page-harness');

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'connect-golden');
const SANCTUM_TAB_ID = 77;
const CHATGPT_LINK_TOKEN = 'phase0-test-link-token';

function readInput(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function box(harness, id) {
  const el = harness.document.getElementById(id);
  return el ? { className: el.className, text: el.textContent, html: el.innerHTML } : null;
}

function fetchSummary(harness) {
  return harness.fetchCalls.map((call) => {
    let body = null;
    try { body = call.init.body ? JSON.parse(call.init.body) : null; } catch (e) { body = String(call.init.body); }
    return normalizeVolatile({
      url: call.url,
      method: call.init.method || 'GET',
      headers: call.init.headers || null,
      body
    });
  });
}

function spyRefresh(harness) {
  const calls = [];
  const original = harness.window.refreshChatGptLinkIfNeeded;
  harness.window.refreshChatGptLinkIfNeeded = function (provider) {
    const entry = { provider, settled: false };
    calls.push(entry);
    const inner = original.apply(this, arguments);
    // Resolve on a later macrotask so a caller that awaits is observably different
    // from one that does not.
    return new Promise((resolve, reject) => {
      setImmediate(() => {
        Promise.resolve(inner).then((value) => {
          entry.settled = true;
          entry.result = value;
          resolve(value);
        }, reject);
      });
    });
  };
  return calls;
}

function snapshotConnection(harness, provider) {
  return normalizeVolatile(harness.window.LeagueConnection.getConnection(provider));
}

/* ------------------------------------------------------------------ */
/* CBS receiver                                                        */
/* ------------------------------------------------------------------ */

async function observeCbsSync(harness, capture, lcCalls, refreshCalls) {
  lcCalls.length = 0;
  refreshCalls.length = 0;
  const returned = await harness.window.receiveCbsConnection(clone(capture));
  const refreshSettledBeforeReturn = refreshCalls.every((c) => c.settled);
  await harness.settle();
  return {
    leagueConnectionCalls: lcCalls.slice(),
    refreshChatGptLinkCalls: refreshCalls.map((c) => ({ provider: c.provider, result: c.result })),
    refreshSettledBeforeReceiverResolved: refreshSettledBeforeReturn,
    returned: normalizeVolatile(returned),
    storedConnection: snapshotConnection(harness, 'cbs'),
    activeConnectionId: harness.getStoredState().activeConnectionId,
    selectedProvider: harness.window.selectedProvider,
    cbsResult: box(harness, 'cbsResult')
  };
}

function secondCbsCapture(capture) {
  const second = clone(capture);
  second.roster.push({
    cbsPlayerId: '3054211',
    name: 'Tyjae Spears',
    position: 'RB',
    nflTeam: 'TEN',
    status: 'active',
    projectedPoints: null
  });
  second.team.wins = 3;
  second.meta.capturedAt = '2026-09-27T18:00:00.000Z';
  return second;
}

async function cbsValidationFailure(mutate) {
  const harness = loadConnectPage();
  const capture = mutate(readInput('cbs-capture.input.json'));
  let message = null;
  try {
    await harness.window.receiveCbsConnection(capture);
  } catch (err) {
    message = err.message;
  }
  await harness.settle();
  return {
    thrownMessage: message,
    cbsResult: box(harness, 'cbsResult'),
    storedState: normalizeVolatile(harness.getStoredState())
  };
}

async function runCbsReceiverScenarios() {
  const capture = readInput('cbs-capture.input.json');

  const harness = loadConnectPage();
  const lcCalls = spyLeagueConnection(harness);
  const refreshCalls = spyRefresh(harness);
  const firstSync = await observeCbsSync(harness, capture, lcCalls, refreshCalls);
  const secondSync = await observeCbsSync(harness, secondCbsCapture(capture), lcCalls, refreshCalls);

  const linkedHarness = loadConnectPage({
    fetchResponder: async () => ({
      status: 200,
      body: { success: true, linkToken: CHATGPT_LINK_TOKEN, updatedAt: '2026-09-26T18:00:05.000Z' }
    })
  });
  linkedHarness.window.localStorage.setItem(
    'innerSanctum_chatgptLeagueLinks',
    JSON.stringify({ cbs: { linkToken: CHATGPT_LINK_TOKEN } })
  );
  const linkedLc = spyLeagueConnection(linkedHarness);
  const linkedRefresh = spyRefresh(linkedHarness);
  const withChatGptLink = await observeCbsSync(linkedHarness, capture, linkedLc, linkedRefresh);
  withChatGptLink.chatGptSnapshotRequests = fetchSummary(linkedHarness);
  withChatGptLink.chatgptLinkMessage = box(linkedHarness, 'chatgptLinkMessage');

  return {
    firstSync,
    secondSync,
    withChatGptLink,
    validation: {
      missingLeague: await cbsValidationFailure((c) => { delete c.league; return c; }),
      missingTeam: await cbsValidationFailure((c) => { delete c.team; return c; }),
      rosterNotArray: await cbsValidationFailure((c) => { c.roster = { notAnArray: true }; return c; })
    }
  };
}

/* ------------------------------------------------------------------ */
/* ESPN extension delivery                                             */
/* ------------------------------------------------------------------ */

async function deliverEspn(worker, harness, capture, lcCalls, refreshCalls) {
  lcCalls.length = 0;
  refreshCalls.length = 0;
  worker.executeScriptCalls.length = 0;
  await worker.context.deliverEspnToSanctum(SANCTUM_TAB_ID, clone(capture));
  const details = worker.executeScriptCalls[worker.executeScriptCalls.length - 1];
  const returned = runInjectedFunction(harness, details);
  await harness.settle();
  return {
    executeScript: { target: details.target, world: details.world, argCount: (details.args || []).length },
    leagueConnectionCalls: lcCalls.slice(),
    refreshChatGptLinkCalls: refreshCalls.map((c) => ({ provider: c.provider, result: c.result })),
    returned: normalizeVolatile(returned),
    storedConnection: snapshotConnection(harness, 'espn'),
    activeConnectionId: harness.getStoredState().activeConnectionId,
    selectedProvider: harness.window.selectedProvider,
    espnResult: box(harness, 'espnResult')
  };
}

async function runEspnDeliveryScenarios() {
  const capture = readInput('espn-capture.input.json');
  const worker = loadExtensionWorker();
  const harness = loadConnectPage();
  const lcCalls = spyLeagueConnection(harness);
  const refreshCalls = spyRefresh(harness);

  const firstDelivery = await deliverEspn(worker, harness, capture, lcCalls, refreshCalls);

  const second = clone(capture);
  second.roster.push({
    providerPlayerId: '4596448', name: 'Tyjae Spears', position: 'RB', nflTeam: 'TEN',
    lineupSlot: 'Bench', injuryStatus: 'QUESTIONABLE', projectedPoints: 6.3
  });
  second.team.wins = 3;
  const secondDelivery = await deliverEspn(worker, harness, second, lcCalls, refreshCalls);

  // The delivered function's own validation (executed in the page, MAIN world).
  const incompleteHarness = loadConnectPage();
  const incompleteWorker = loadExtensionWorker();
  const incomplete = clone(capture);
  incomplete.roster = [];
  await incompleteWorker.context.deliverEspnToSanctum(SANCTUM_TAB_ID, incomplete);
  let incompleteMessage = null;
  try {
    runInjectedFunction(incompleteHarness, incompleteWorker.executeScriptCalls.pop());
  } catch (err) {
    incompleteMessage = err.message;
  }

  return {
    firstDelivery,
    secondDelivery,
    incompleteRoster: {
      thrownMessage: incompleteMessage,
      storedState: normalizeVolatile(incompleteHarness.getStoredState())
    }
  };
}

/* ------------------------------------------------------------------ */
/* CBS message listener / popup                                        */
/* ------------------------------------------------------------------ */

async function runCbsListenerScenarios() {
  const blocked = loadConnectPage({ openResult: null });
  blocked.window.startCbsConnect();
  const opened = loadConnectPage();
  opened.window.startCbsConnect();
  return {
    blockedPopup: {
      openCalls: blocked.openCalls,
      cbsConnectWindowIsNull: blocked.window.cbsConnectWindow === null,
      cbsResult: box(blocked, 'cbsResult')
    },
    openedPopup: {
      openCalls: opened.openCalls,
      popupFocused: opened.popup.focusCalls,
      cbsResult: box(opened, 'cbsResult')
    }
  };
}

/* ------------------------------------------------------------------ */
/* Desktop markup                                                      */
/* ------------------------------------------------------------------ */

function providerForm(harness) {
  const form = harness.document.querySelector('#providerForms .provider-form');
  return form ? { className: form.className, innerHTML: form.innerHTML } : null;
}

function platformRow(harness) {
  return harness.document.querySelectorAll('#platformRow .platform-btn').map((btn) => ({
    id: btn.id,
    className: btn.className
  }));
}

async function runMarkupScenarios() {
  const cbsHarness = loadConnectPage();
  const cbsDisconnected = { platformRow: platformRow(cbsHarness), providerForm: providerForm(cbsHarness) };

  await cbsHarness.window.receiveCbsConnection(readInput('cbs-capture.input.json'));
  await cbsHarness.settle();
  const cbsConnectedForm = providerForm(cbsHarness);

  const espnHarness = loadConnectPage();
  const espnButton = espnHarness.document.getElementById('platform-espn');
  espnButton.onclick();
  const espnRendered = { platformRow: platformRow(espnHarness), providerForm: providerForm(espnHarness) };
  const clickEvent = espnHarness.createEvent('click', { bubbles: true });
  clickEvent.target = espnButton;
  espnHarness.document.getElementById('platformRow').dispatchEvent(clickEvent);
  await espnHarness.settle();
  const espnGuarded = { providerForm: providerForm(espnHarness) };

  return {
    userAgent: cbsHarness.window.navigator.userAgent,
    cbs: { disconnected: cbsDisconnected, connected: { providerForm: cbsConnectedForm } },
    espn: {
      renderedByPage: espnRendered,
      afterNoExtensionSafetyGuard: espnGuarded
    }
  };
}

// Observations are returned as plain JSON in Node's own realm. Values created
// inside vm contexts carry that context's Object prototype, which would make
// deepStrictEqual report differences that are not behavioral.
function plain(run) {
  return async function () { return clone(await run()); };
}

module.exports = {
  FIXTURE_DIR,
  SANCTUM_TAB_ID,
  readInput,
  clone,
  box,
  spyRefresh,
  runCbsReceiverScenarios: plain(runCbsReceiverScenarios),
  runEspnDeliveryScenarios: plain(runEspnDeliveryScenarios),
  runCbsListenerScenarios: plain(runCbsListenerScenarios),
  runMarkupScenarios: plain(runMarkupScenarios)
};
