const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const workerPath = path.join(__dirname, '..', 'cbs-extension', 'service-worker-v050.js');
const source = fs.readFileSync(workerPath, 'utf8');

function makeHarness() {
  const updatedListeners = [];
  const storage = {
    pendingEspnConnect: { sanctumTabId: 10, providerTabId: 20, startedAt: Date.now() }
  };
  let captureAttempts = 0;
  let sanctumActivations = 0;

  const chrome = {
    storage: { session: {
      async get(key) { return { [key]: storage[key] }; },
      async set(value) { Object.assign(storage, value); },
      async remove(key) { delete storage[key]; }
    }},
    tabs: {
      async query() { return []; },
      async get(id) {
        if (id === 10) return { id: 10, url: 'https://theinnersanctum.xyz/connect-league' };
        return { id: 20, url: 'https://fantasy.espn.com/football/team?leagueId=1094040685&teamId=10&seasonId=2026' };
      },
      async update(id) { if (id === 10) sanctumActivations += 1; return { id }; },
      async create() { throw new Error('not used'); },
      async sendMessage() {
        captureAttempts += 1;
        if (captureAttempts <= 3) return { success: false, error: 'ESPN league data is still loading.' };
        return {
          success: true,
          data: {
            league: { id: '1094040685', name: 'Los Angeles Pro H2H Points PPR League', season: 2026, teamCount: 10 },
            team: { id: '10', name: 'Old School' },
            roster: [{ id: '1', name: 'Joe Burrow' }],
            meta: { dataQuality: { complete: true } }
          }
        };
      },
      onUpdated: { addListener(fn) { updatedListeners.push(fn); } }
    },
    runtime: { onMessage: { addListener() {} } },
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

  return { updatedListeners, storage, get captureAttempts() { return captureAttempts; }, get sanctumActivations() { return sanctumActivations; } };
}

(async function () {
  const h = makeHarness();
  assert.strictEqual(h.updatedListeners.length, 1, 'expected one ESPN onUpdated listener');
  const leagueTab = { id: 20, url: 'https://fantasy.espn.com/football/team?leagueId=1094040685&teamId=10&seasonId=2026' };

  await h.updatedListeners[0](20, { status: 'complete' }, leagueTab);
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.ok(h.captureAttempts >= 4, 'pending ESPN capture should retry after an incomplete first capture without another tab update');
  assert.strictEqual(h.storage.pendingEspnConnect, undefined, 'pending ESPN state should clear after a later retry succeeds');
  assert.ok(h.sanctumActivations >= 1, 'Sanctum tab should be activated after successful retry');

  console.log('PASS espn pending capture retries until ready without requiring another navigation event');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
