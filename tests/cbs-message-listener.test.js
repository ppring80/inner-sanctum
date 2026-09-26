'use strict';

// tests/cbs-message-listener.test.js
//
// Phase 0 (mobile league-connect): freezes the desktop CBS bookmark handoff.
// Exercises the REAL startCbsConnect() and the REAL cross-origin "message"
// listener in connect-league.html. Nothing is reimplemented: events are
// delivered to the listener the page itself registered.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadConnectPage } = require('./helpers/connect-page-harness');
const scenarios = require('./helpers/connect-golden-scenarios');

const golden = JSON.parse(
  fs.readFileSync(path.join(scenarios.FIXTURE_DIR, 'cbs-listener.golden.json'), 'utf8')
).observations;

const MESSAGE_TYPE = 'INNER_SANCTUM_CBS_CAPTURE_RESULT';
const CBS_ORIGIN = 'https://phase0league.football.cbssports.com';

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log('  ok - ' + name);
}

function setup() {
  const harness = loadConnectPage();
  const listeners = harness.windowListeners('message');
  assert.strictEqual(listeners.length, 1, 'connect-league.html registers exactly one window "message" listener');
  const received = [];
  harness.window.receiveCbsConnection = function (capture) {
    received.push(capture);
    return Promise.resolve(null);
  };
  harness.window.startCbsConnect();
  const deliver = (event) => listeners[0].fn.call(harness.window, event);
  return { harness, received, deliver, popup: harness.popup };
}

function validEvent(popup, overrides = {}) {
  return {
    origin: CBS_ORIGIN,
    source: popup,
    data: { type: MESSAGE_TYPE, capture: { league: { id: 'x' }, team: { id: '1' }, roster: [] } },
    ...overrides
  };
}

(async function run() {
  await test('rejects a non-CBS origin', async () => {
    const { received, deliver, popup, harness } = setup();
    ['https://evil.example', 'https://www.cbssports.com', 'http://phase0league.football.cbssports.com',
      'https://phase0league.football.cbssports.com.evil.example', '']
      .forEach((origin) => deliver(validEvent(popup, { origin })));
    assert.strictEqual(received.length, 0);
    assert.strictEqual(harness.window.cbsConnectWindow, popup, 'a rejected message must not clear the popup handle');
  });

  await test('rejects the wrong source window', async () => {
    const { received, deliver, popup } = setup();
    deliver(validEvent(popup, { source: { someOtherWindow: true } }));
    assert.strictEqual(received.length, 0);
  });

  await test('rejects the wrong message type', async () => {
    const { received, deliver, popup } = setup();
    deliver(validEvent(popup, { data: { type: 'INNER_SANCTUM_ESPN_CAPTURE_RESULT', capture: {} } }));
    deliver(validEvent(popup, { data: 'INNER_SANCTUM_CBS_CAPTURE_RESULT' }));
    deliver(validEvent(popup, { data: null }));
    assert.strictEqual(received.length, 0);
  });

  await test('rejects a missing capture', async () => {
    const { received, deliver, popup } = setup();
    deliver(validEvent(popup, { data: { type: MESSAGE_TYPE } }));
    deliver(validEvent(popup, { data: { type: MESSAGE_TYPE, capture: null } }));
    assert.strictEqual(received.length, 0);
  });

  await test('accepts a valid CBS message exactly once and clears cbsConnectWindow', async () => {
    const { received, deliver, popup, harness } = setup();
    const event = validEvent(popup);
    deliver(event);
    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0], event.data.capture, 'the capture object is passed through unchanged');
    assert.strictEqual(harness.window.cbsConnectWindow, null);
  });

  await test('a valid message reaches the real receiver and persists the connection', async () => {
    const harness = loadConnectPage();
    harness.window.startCbsConnect();
    const listener = harness.windowListeners('message')[0];
    listener.fn.call(harness.window, {
      origin: CBS_ORIGIN,
      source: harness.popup,
      data: { type: MESSAGE_TYPE, capture: scenarios.readInput('cbs-capture.input.json') }
    });
    await harness.settle();
    const connection = harness.window.LeagueConnection.getConnection('cbs');
    assert.ok(connection, 'CBS connection must be stored');
    assert.strictEqual(connection.connectionMode, 'browser-assisted');
    assert.strictEqual(harness.document.getElementById('cbsResult').className, 'result-box success show');
  });

  await test('current behavior (frozen, not endorsed): without an open popup handle any CBS-origin window is accepted', async () => {
    // Documented so the mobile work cannot change it silently. If this should
    // be tightened, do it deliberately in its own change and re-baseline.
    const harness = loadConnectPage();
    const received = [];
    harness.window.receiveCbsConnection = (capture) => { received.push(capture); return Promise.resolve(null); };
    harness.windowListeners('message')[0].fn.call(harness.window, {
      origin: CBS_ORIGIN,
      source: { anyWindow: true },
      data: { type: MESSAGE_TYPE, capture: { league: {}, team: {}, roster: [] } }
    });
    assert.strictEqual(received.length, 1);
  });

  await test('blocked popup preserves the existing customer error', async () => {
    const observed = await scenarios.runCbsListenerScenarios();
    assert.deepStrictEqual(observed.blockedPopup, golden.blockedPopup);
    assert.strictEqual(observed.blockedPopup.cbsResult.className, 'result-box error show');
    assert.strictEqual(
      observed.blockedPopup.cbsResult.text,
      '⚠️ CBS could not be opened. Allow pop-ups for The Inner Sanctum and try again.'
    );
  });

  await test('opened popup behavior (URL, window name, focus, instructions) is unchanged', async () => {
    const observed = await scenarios.runCbsListenerScenarios();
    assert.deepStrictEqual(observed.openedPopup, golden.openedPopup);
    assert.deepStrictEqual(observed.openedPopup.openCalls, [
      { url: 'https://www.cbssports.com/fantasy/football/', name: 'innerSanctumCbsConnect' }
    ]);
  });

  console.log('cbs-message-listener.test.js: ' + passed + ' passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
