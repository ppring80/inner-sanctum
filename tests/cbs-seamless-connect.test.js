const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadWorker(overrides = {}) {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "cbs-extension", "service-worker.js"),
    "utf8"
  );

  const runtimeListeners = [];
  const updatedListeners = [];
  const createdTabs = [];
  const updatedTabs = [];
  const storage = { ...(overrides.initialStorage || {}) };
  let sendAttempts = 0;

  const chrome = {
    tabs: {
      async query() {
        return overrides.queryTabs || [];
      },
      async create(options) {
        createdTabs.push(options);
        return { id: 901, url: options.url, active: true };
      },
      async update(id, options) {
        updatedTabs.push({ id, options });
        return { id, ...(options || {}) };
      },
      async get(id) {
        if (typeof overrides.getTab === "function") {
          return overrides.getTab(id);
        }
        return { id, url: "https://theinnersanctum.xyz/connect-league", active: true };
      },
      async sendMessage() {
        sendAttempts += 1;
        if (typeof overrides.sendMessage === "function") {
          return overrides.sendMessage(sendAttempts);
        }
        return { success: true };
      },
      onUpdated: {
        addListener(fn) {
          updatedListeners.push(fn);
        }
      }
    },
    storage: {
      session: {
        async get(key) {
          return { [key]: storage[key] };
        },
        async set(values) {
          Object.assign(storage, values);
        },
        async remove(key) {
          delete storage[key];
        }
      }
    },
    scripting: {
      async executeScript() {
        return [];
      }
    },
    runtime: {
      onMessage: {
        addListener(fn) {
          runtimeListeners.push(fn);
        }
      }
    }
  };

  const context = {
    chrome,
    console,
    Date: overrides.Date || Date,
    setTimeout(fn) {
      fn();
      return 1;
    },
    clearTimeout() {}
  };

  vm.runInNewContext(source, context, { filename: "service-worker.js" });

  async function sendStartMessage() {
    assert.equal(runtimeListeners.length, 1, "expected one CBS runtime listener");
    return new Promise((resolve, reject) => {
      let settled = false;
      const ret = runtimeListeners[0](
        { type: "INNER_SANCTUM_START_CBS_CONNECT" },
        { tab: { id: 77, url: "https://theinnersanctum.xyz/connect-league" } },
        (response) => {
          settled = true;
          resolve(response);
        }
      );
      assert.equal(ret, true);
      setImmediate(() => {
        if (!settled) reject(new Error("CBS listener did not respond"));
      });
    });
  }

  return {
    sendStartMessage,
    createdTabs,
    updatedTabs,
    storage,
    updatedListeners,
    getSendAttempts: () => sendAttempts
  };
}

function validCapture() {
  return {
    league: { id: "L1", name: "League" },
    team: { id: "T1", name: "Team" },
    meta: { dataQuality: { complete: true } }
  };
}

(async function run() {
  {
    const harness = loadWorker({ queryTabs: [] });
    const response = await harness.sendStartMessage();

    assert.equal(response.success, true);
    assert.equal(response.pending, true);
    assert.equal(harness.createdTabs.length, 1);
    assert.match(harness.createdTabs[0].url, /cbssports\.com\/fantasy\/football/i);
    assert.ok(harness.storage.pendingCbsConnect, "CBS pending state should be stored");
    assert.equal(harness.storage.pendingCbsConnect.sanctumTabId, 77);
    assert.equal(harness.storage.pendingCbsConnect.providerTabId, 901);
  }

  {
    const cbsTab = {
      id: 222,
      active: true,
      url: "https://example.football.cbssports.com/"
    };

    const captured = validCapture();

    const harness = loadWorker({
      queryTabs: [cbsTab],
      sendMessage(attempt) {
        if (attempt < 3) {
          throw new Error("Receiving end does not exist");
        }
        return { success: true, data: captured };
      }
    });

    const response = await harness.sendStartMessage();
    assert.equal(response.success, true);
    assert.equal(harness.getSendAttempts(), 3, "CBS capture should retry transient receiver misses");
  }

  {
    const cbsTab = {
      id: 222,
      active: true,
      url: "https://example.football.cbssports.com/"
    };

    const harness = loadWorker({
      queryTabs: [cbsTab],
      sendMessage() {
        throw new Error("Receiving end does not exist");
      }
    });

    const response = await harness.sendStartMessage();
    assert.equal(response.success, true);
    assert.equal(response.pending, true, "exhausted retries should degrade to pending state");
    assert.equal(harness.getSendAttempts(), 3);
    assert.equal(harness.storage.pendingCbsConnect.providerTabId, 222);
    assert.equal(harness.updatedTabs[0].id, 222, "existing CBS tab should be focused for user navigation");
  }

  {
    const captured = validCapture();
    const harness = loadWorker({
      queryTabs: [],
      sendMessage() {
        return { success: true, data: captured };
      }
    });

    const response = await harness.sendStartMessage();
    assert.equal(response.pending, true);
    assert.equal(harness.updatedListeners.length, 1, "expected one CBS tab update listener");

    const leagueTab = {
      id: 901,
      active: true,
      url: "https://example.football.cbssports.com/league/home"
    };

    await harness.updatedListeners[0](
      901,
      { url: leagueTab.url, status: "complete" },
      leagueTab
    );

    assert.equal(harness.getSendAttempts(), 1, "tracked CBS league navigation should trigger capture");
    assert.equal(harness.storage.pendingCbsConnect, undefined, "pending CBS state should clear after successful capture");
    assert.ok(
      harness.updatedTabs.some((entry) => entry.id === 77 && entry.options.active === true),
      "successful tracked capture should refocus Inner Sanctum"
    );
  }

  {
    const harness = loadWorker({ queryTabs: [] });
    await harness.sendStartMessage();

    assert.equal(harness.updatedListeners.length, 1);
    const unrelatedLeagueTab = {
      id: 902,
      active: true,
      url: "https://other.football.cbssports.com/league/home"
    };

    await harness.updatedListeners[0](
      902,
      { url: unrelatedLeagueTab.url, status: "complete" },
      unrelatedLeagueTab
    );

    assert.equal(harness.getSendAttempts(), 0, "CBS listener must ignore non-tracked tabs");
    assert.equal(harness.storage.pendingCbsConnect.providerTabId, 901);
  }

  {
    class ExpiredDate extends Date {
      static now() {
        return 20 * 60 * 1000;
      }
    }

    const harness = loadWorker({
      queryTabs: [],
      Date: ExpiredDate,
      initialStorage: {
        pendingCbsConnect: {
          sanctumTabId: 77,
          providerTabId: 901,
          startedAt: 1
        }
      }
    });

    assert.equal(harness.updatedListeners.length, 1);
    await harness.updatedListeners[0](
      901,
      { url: "https://example.football.cbssports.com/league/home" },
      { id: 901, url: "https://example.football.cbssports.com/league/home" }
    );

    assert.equal(harness.storage.pendingCbsConnect, undefined, "expired CBS pending state should be cleared");
    assert.equal(harness.getSendAttempts(), 0, "expired pending state must not attempt capture");
  }

  console.log("PASS cbs-seamless-connect");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
