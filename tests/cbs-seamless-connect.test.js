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
  const storage = {};
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
      async update() {
        return {};
      },
      async get(id) {
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

  return { sendStartMessage, createdTabs, storage, updatedListeners, getSendAttempts: () => sendAttempts };
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
  }

  {
    const cbsTab = {
      id: 222,
      active: true,
      url: "https://example.football.cbssports.com/"
    };

    const captured = {
      league: { id: "L1", name: "League" },
      team: { id: "T1", name: "Team" },
      meta: { dataQuality: { complete: true } }
    };

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

  console.log("PASS cbs-seamless-connect");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
