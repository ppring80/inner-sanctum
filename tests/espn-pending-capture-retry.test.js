const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const workerPath = path.join(__dirname, '..', 'cbs-extension', 'service-worker-v050.js');
const source = fs.readFileSync(workerPath, 'utf8');
const leagueUrl = 'https://fantasy.espn.com/football/team?leagueId=1094040685&teamId=10&seasonId=2026';
const sanctumUrl = 'https://theinnersanctum.xyz/connect-league';

function successPayload() {
  return {
    success: true,
    data: {
      league: { id: '1094040685', name: 'Los Angeles Pro H2H Points PPR League', season: 2026, teamCount: 10 },
      team: { id: '10', name: 'Old School' },
      roster: [{ id: '1', name: 'Joe Burrow' }],
      meta: { dataQuality: { complete: true } }
    }
  };
}

function makeHarness(options = {}) {
  const updatedListeners = [];
  const runtimeListeners = [];
  const storage = options.pending === false ? {} : {
    pendingEspnConnect: { sanctumTabId: 10, providerTabId: 20, startedAt: Date.now() }
  };
  let captureAttempts = 0;
  let activeCaptures = 0;
  let maxActiveCaptures = 0;
  let sanctumActivations = 0;
  let providerActivations = 0;
  let blockedRetryResolve = null;

  async function sendMessage() {
    captureAttempts += 1;
    activeCaptures += 1;
    maxActiveCaptures = Math.max(maxActiveCaptures, activeCaptures);
    try {
      if (options.raceMode) {
        if (captureAttempts === 1) {
          return { success: false, error: 'ESPN league data is still loading.' };
        }
        if (captureAttempts === 2) {
          await new Promise((resolve) => { blockedRetryResolve = resolve; });
          return { success: false, error: 'ESPN league data is still loading.' };
        }
        return successPayload();
      }

      if (captureAttempts <= 3) {
        return { success: false, error: 'ESPN league data is still loading.' };
      }
      return successPayload();
    } finally {
      activeCaptures -= 1;
    }
  }

  const chrome = {
    storage: { session: {
      async get(key) { return { [key]: storage[key] }; },
      async set(value) { Object.assign(storage, value); },
      async remove(key) { delete storage[key]; }
    }},
    tabs: {
      async query() { return options.raceMode ? [{ id: 20, url: leagueUrl, active: false }] : []; },
      async get(id) {
        if (id === 10) return { id: 10, url: sanctumUrl };
        return { id: 20, url: leagueUrl };
      },
      async update(id) {
        if (id === 10) sanctumActivations += 1;
        if (id === 20) providerActivations += 1;
        return { id };
      },
      async create() { throw new Error('not used'); },
      sendMessage,
      onUpdated: { addListener(fn) { updatedListeners.push(fn); } }
    },
    runtime: { onMessage: { addListener(fn) { runtimeListeners.push(fn); } } },
    scripting: {
      async executeScript(options) {
        if (options.target.tabId === 10 && options.args && options.args[0] && options.args[0].league) {
          return [{ result: options.args[0] }];
        }
        return [{ result: true }];
      }
    }
  };

  const context = {
    chrome,
    browser: undefined,
    globalThis: null,
    console,
    URL,
    setTimeout: (fn) => { Promise.resolve().then(fn); return 1; },
    clearTimeout() {},
    importScripts() {}
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: workerPath });

  return {
    updatedListeners,
    runtimeListeners,
    storage,
    releaseBlockedRetry() {
      assert.ok(blockedRetryResolve, 'expected a blocked retry capture');
      const resolve = blockedRetryResolve;
      blockedRetryResolve = null;
      resolve();
    },
    get captureAttempts() { return captureAttempts; },
    get activeCaptures() { return activeCaptures; },
    get maxActiveCaptures() { return maxActiveCaptures; },
    get sanctumActivations() { return sanctumActivations; },
    get providerActivations() { return providerActivations; }
  };
}

async function flushUntil(predicate, message) {
  for (let i = 0; i < 100; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(message);
}

async function testRetryWithoutSecondNavigation() {
  const h = makeHarness();
  assert.strictEqual(h.updatedListeners.length, 1, 'expected one ESPN onUpdated listener');
  const leagueTab = { id: 20, url: leagueUrl };

  await h.updatedListeners[0](20, { status: 'complete' }, leagueTab);
  await flushUntil(() => h.storage.pendingEspnConnect === undefined, 'pending ESPN state did not clear');

  assert.ok(h.captureAttempts >= 4, 'pending ESPN capture should retry after an incomplete first capture without another tab update');
  assert.strictEqual(h.storage.pendingEspnConnect, undefined, 'pending ESPN state should clear after a later retry succeeds');
  assert.ok(h.sanctumActivations >= 1, 'Sanctum tab should be activated after successful retry');
}

async function testRuntimeAndOnUpdatedCannotOverlap() {
  const h = makeHarness({ pending: false, raceMode: true });
  assert.strictEqual(h.runtimeListeners.length, 1, 'expected one ESPN runtime listener');
  assert.strictEqual(h.updatedListeners.length, 1, 'expected one ESPN onUpdated listener');

  let runtimeResponse = null;
  h.runtimeListeners[0](
    { type: 'INNER_SANCTUM_START_ESPN_CONNECT' },
    { tab: { id: 10, url: sanctumUrl } },
    (response) => { runtimeResponse = response; }
  );

  await flushUntil(() => h.captureAttempts === 2 && h.activeCaptures === 1, 'beginEspnConnect did not enter its guarded pending retry');

  const attemptsBeforeUpdate = h.captureAttempts;
  await h.updatedListeners[0](20, { status: 'complete' }, { id: 20, url: leagueUrl });
  assert.strictEqual(h.captureAttempts, attemptsBeforeUpdate, 'onUpdated must not start a second capture while the pending retry is already in flight');
  assert.strictEqual(h.maxActiveCaptures, 1, 'ESPN retry entry points must never overlap sendMessage calls');

  h.releaseBlockedRetry();
  await flushUntil(() => h.storage.pendingEspnConnect === undefined, 'guarded runtime retry did not finish');
  await flushUntil(() => runtimeResponse !== null, 'runtime listener did not respond');

  assert.strictEqual(h.maxActiveCaptures, 1, 'only one ESPN capture loop may be active for a tab');
  assert.strictEqual(h.captureAttempts, 3, 'expected initial capture, one blocked retry, then one successful retry');
  assert.strictEqual(runtimeResponse.success, true, 'Connect request should remain pending/successful while background retry completes');
  assert.ok(h.providerActivations >= 1, 'existing ESPN tab should be activated');
  assert.ok(h.sanctumActivations >= 1, 'Sanctum should be reactivated after successful capture');
}

(async function () {
  await testRetryWithoutSecondNavigation();
  await testRuntimeAndOnUpdatedCannotOverlap();
  console.log('PASS ESPN pending capture retries without navigation and prevents overlapping retry loops');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
