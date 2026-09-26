'use strict';

// tests/extension-contract.test.js
//
// Phase 0 (mobile league-connect): protects the interface between the Link
// Your League page and the existing "The Inner Sanctum — Connect" Chrome
// extension. Assertions are behavioral wherever possible: the real
// sanctum-content-bridge.js runs against the real page DOM in its own
// (isolated-world) context, and the real background workers are driven
// through their real message listeners.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
  REPO_ROOT,
  loadConnectPage,
  loadExtensionWorker,
  runInjectedFunction
} = require('./helpers/connect-page-harness');
const scenarios = require('./helpers/connect-golden-scenarios');

const EXT = path.join(REPO_ROOT, 'cbs-extension');
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
const readExt = (file) => fs.readFileSync(path.join(EXT, file), 'utf8');

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log('  ok - ' + name);
}

function contentScriptsFor(match) {
  return manifest.content_scripts.filter((entry) => entry.matches.includes(match));
}

/** Run the real sanctum-content-bridge.js in an isolated world sharing the page DOM. */
function loadSanctumBridge(harness) {
  const sent = [];
  const isolated = {
    document: harness.document,
    console,
    queueMicrotask,
    MutationObserver: class { observe() {} disconnect() {} },
    chrome: {
      runtime: {
        async sendMessage(message) {
          sent.push(message);
          return { success: true, pending: true };
        }
      }
    }
  };
  isolated.globalThis = isolated;
  vm.runInContext(readExt('sanctum-content-bridge.js'), vm.createContext(isolated), {
    filename: 'cbs-extension/sanctum-content-bridge.js'
  });
  return { sent, isolated };
}

function clickCapture(harness, target) {
  const listeners = harness.documentListeners('click').filter((l) => l.capture);
  const event = harness.createEvent('click', { bubbles: true });
  event.target = target;
  listeners.forEach((l) => { if (!event.immediatePropagationStopped) l.fn.call(harness.document, event); });
  return event;
}

async function flushMicrotasks() {
  await new Promise((resolve) => setImmediate(resolve));
}

(async function run() {
  /* ---------------- manifest ---------------- */

  await test('manifest: MV3 background worker is service-worker-v050.js, which imports service-worker.js', async () => {
    assert.strictEqual(manifest.manifest_version, 3);
    assert.strictEqual(manifest.background.service_worker, 'service-worker-v050.js');
    assert.match(readExt('service-worker-v050.js'), /importScripts\(\s*["']service-worker\.js["']\s*\)/);
  });

  await test('manifest: CBS league pages get the connector in MAIN and the bridge in ISOLATED', async () => {
    const entries = contentScriptsFor('https://*.football.cbssports.com/*');
    const main = entries.find((e) => e.world === 'MAIN');
    const isolated = entries.find((e) => e.world === 'ISOLATED');
    assert.ok(main && isolated);
    ['cbs-browser-connector.js', 'cbs-main-bridge.js'].forEach((f) => assert.ok(main.js.includes(f), f + ' in MAIN'));
    assert.ok(isolated.js.includes('cbs-content-bridge.js'));
  });

  await test('manifest: ESPN league pages get the main bridge in MAIN and the content bridge in ISOLATED', async () => {
    const entries = contentScriptsFor('https://fantasy.espn.com/football/*');
    assert.ok(entries.find((e) => e.world === 'MAIN' && e.js.includes('espn-main-bridge.js')));
    assert.ok(entries.find((e) => e.world === 'ISOLATED' && e.js.includes('espn-content-bridge.js')));
  });

  await test('manifest: the Sanctum bridge runs ISOLATED on both connect-league origins', async () => {
    ['https://theinnersanctum.xyz/connect-league*', 'https://www.theinnersanctum.xyz/connect-league*'].forEach((m) => {
      const entry = contentScriptsFor(m).find((e) => e.js.includes('sanctum-content-bridge.js'));
      assert.ok(entry, 'sanctum-content-bridge.js matches ' + m);
      assert.strictEqual(entry.world, 'ISOLATED');
    });
  });

  await test('internal message names agree between each sender and its receiver', async () => {
    const constant = (source, name) => {
      const m = source.match(new RegExp('const\\s+' + name + '\\s*=\\s*"([^"]+)"'));
      return m && m[1];
    };
    ['REQUEST', 'RESPONSE'].forEach((name) => {
      assert.ok(constant(readExt('cbs-content-bridge.js'), name));
      assert.strictEqual(constant(readExt('cbs-content-bridge.js'), name), constant(readExt('cbs-main-bridge.js'), name));
      assert.strictEqual(constant(readExt('espn-content-bridge.js'), name), constant(readExt('espn-main-bridge.js'), name));
    });
    assert.match(readExt('service-worker.js'), /type:\s*"INNER_SANCTUM_CBS_CAPTURE"/);
    assert.match(readExt('cbs-content-bridge.js'), /"INNER_SANCTUM_CBS_CAPTURE"/);
  });

  /* ---------------- page globals ---------------- */

  await test('page exposes the globals the extension calls by name', async () => {
    const harness = loadConnectPage();
    const w = harness.window;
    assert.strictEqual(typeof w.receiveCbsConnection, 'function');
    assert.strictEqual(typeof w.refreshChatGptLinkIfNeeded, 'function');
    assert.strictEqual(typeof w.LeagueConnection, 'object');
    ['connect', 'update', 'isConnected', 'getConnection'].forEach((m) => {
      assert.strictEqual(typeof w.LeagueConnection[m], 'function', 'LeagueConnection.' + m);
    });
    ['renderPlatformRow', 'renderConnectedBanner', 'renderProviderForm', 'renderChatGptLinkPanel'].forEach((fn) => {
      assert.strictEqual(typeof w[fn], 'function', fn);
    });
    assert.strictEqual(w.selectedProvider, 'cbs', 'selectedProvider is a page global (default cbs)');
  });

  /* ---------------- Sanctum bridge (isolated world) ---------------- */

  await test('bridge intercepts CBS Connect in the capture phase and sends INNER_SANCTUM_START_CBS_CONNECT', async () => {
    const harness = loadConnectPage();
    const { sent } = loadSanctumBridge(harness);
    const captureListeners = harness.documentListeners('click').filter((l) => l.capture);
    assert.strictEqual(captureListeners.length, 1, 'exactly one capture-phase click listener from the bridge');

    const button = harness.document.querySelector('#providerForms .connect-btn');
    const event = clickCapture(harness, button);
    assert.strictEqual(event.defaultPrevented, true);
    assert.strictEqual(event.immediatePropagationStopped, true, 'page onclick startCbsConnect() must not also run');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(sent)), [{ type: 'INNER_SANCTUM_START_CBS_CONNECT' }]);
    assert.strictEqual(harness.openCalls.length, 0, 'the bookmark popup path is bypassed when the extension is present');
    const box = harness.document.getElementById('cbsResult');
    assert.strictEqual(box.className, 'result-box loading show');
    await flushMicrotasks();
  });

  await test('bridge intercepts ESPN Connect and sends INNER_SANCTUM_START_ESPN_CONNECT', async () => {
    const harness = loadConnectPage();
    const { sent } = loadSanctumBridge(harness);
    const espnButton = harness.document.getElementById('platform-espn');
    espnButton.onclick();
    clickCapture(harness, espnButton); // platform click queues the bridge's ESPN form refresh
    await flushMicrotasks();

    const form = harness.document.getElementById('espnResult').closest('.provider-form');
    assert.ok(form.querySelector('.inner-sanctum-espn-connect-info'), 'bridge injects its ESPN info block');
    const button = harness.document.querySelector('#providerForms .connect-btn');
    assert.strictEqual(button.textContent, 'Connect ESPN League');
    const event = clickCapture(harness, button);
    assert.strictEqual(event.immediatePropagationStopped, true);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(sent)), [{ type: 'INNER_SANCTUM_START_ESPN_CONNECT' }]);
    await flushMicrotasks();
  });

  await test('bridge ignores clicks on other providers and non-connect elements', async () => {
    const harness = loadConnectPage();
    const { sent } = loadSanctumBridge(harness);
    const other = harness.document.querySelector('#cbsResult');
    const event = clickCapture(harness, other);
    assert.strictEqual(event.defaultPrevented, false);
    assert.strictEqual(sent.length, 0);
  });

  /* ---------------- background workers ---------------- */

  async function dispatch(worker, message, senderUrl) {
    const responses = [];
    const handled = worker.runtimeListeners
      .map((fn) => fn(message, { tab: { id: scenarios.SANCTUM_TAB_ID, url: senderUrl } }, (r) => responses.push(r)))
      .filter((r) => r === true).length;
    for (let i = 0; i < 20 && responses.length < handled; i += 1) await flushMicrotasks();
    return { handled, responses: JSON.parse(JSON.stringify(responses)) };
  }

  await test('workers answer exactly the two Sanctum start messages (one listener each)', async () => {
    const worker = loadExtensionWorker();
    const page = 'https://theinnersanctum.xyz/connect-league';
    const cbs = await dispatch(worker, { type: 'INNER_SANCTUM_START_CBS_CONNECT' }, page);
    assert.strictEqual(cbs.handled, 1);
    assert.deepStrictEqual(cbs.responses, [{ success: true, pending: true }]);

    const espnWorker = loadExtensionWorker();
    const espn = await dispatch(espnWorker, { type: 'INNER_SANCTUM_START_ESPN_CONNECT' }, page);
    assert.strictEqual(espn.handled, 1);
    assert.strictEqual(espn.responses[0].success, true);

    const unknown = await dispatch(loadExtensionWorker(), { type: 'INNER_SANCTUM_SOMETHING_ELSE' }, page);
    assert.strictEqual(unknown.handled, 0);
  });

  await test('CBS start requests from outside the Sanctum page are rejected', async () => {
    const worker = loadExtensionWorker();
    const result = await dispatch(worker, { type: 'INNER_SANCTUM_START_CBS_CONNECT' }, 'https://evil.example/connect-league');
    assert.strictEqual(result.responses[0].success, false);
    assert.match(result.responses[0].error, /did not originate from The Inner Sanctum/);
  });

  await test('CBS worker delivery calls the page global receiveCbsConnection in the MAIN world', async () => {
    const worker = loadExtensionWorker();
    const harness = loadConnectPage();
    await worker.context.deliverToSanctum(scenarios.SANCTUM_TAB_ID, scenarios.readInput('cbs-capture.input.json'));
    const details = worker.executeScriptCalls.pop();
    assert.strictEqual(details.world, 'MAIN');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(details.target)), { tabId: scenarios.SANCTUM_TAB_ID });
    await runInjectedFunction(harness, details);
    await harness.settle();
    const connection = harness.window.LeagueConnection.getConnection('cbs');
    assert.ok(connection && connection.connectionMode === 'browser-assisted');
  });

  console.log('extension-contract.test.js: ' + passed + ' passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
