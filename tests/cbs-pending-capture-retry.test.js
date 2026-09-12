const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Extract CBS_URL_PATTERN directly from the real source so this test can
// never drift from what the production worker actually uses.
const workerSource = fs.readFileSync(
  path.join(__dirname, "..", "cbs-extension", "service-worker.js"),
  "utf8"
);
const CBS_URL_PATTERN = new Function(
  workerSource.slice(
    workerSource.indexOf("const CBS_URL_PATTERN"),
    workerSource.indexOf(";", workerSource.indexOf("const CBS_URL_PATTERN")) + 1
  ) + "\nreturn CBS_URL_PATTERN;"
)();

function loadWorker(overrides = {}) {
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
    // Real delay, but tiny, so the bounded retry loop actually exercises
    // multiple iterations rather than collapsing into one synchronous tick.
    setTimeout(fn, ms) {
      return setTimeout(fn, 0);
    },
    clearTimeout(id) {
      clearTimeout(id);
    }
  };

  vm.runInNewContext(workerSource, context, { filename: "service-worker.js" });

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
    league: { id: "L1", name: "WIDE BODIES" },
    team: { id: "T1", name: "The Vanilla Gorilla" },
    meta: { dataQuality: { complete: true } }
  };
}

function flush(times = 60) {
  return new Promise((resolve) => {
    let n = 0;
    (function tick() {
      n += 1;
      if (n >= times) return resolve();
      setImmediate(tick);
    })();
  });
}

(async function run() {
  // ── A. CBS_URL_PATTERN / trailing-slash behavior against the exact
  //     reported live URL. This documents current regex behavior with
  //     the real production regex, not a copy of it. ──
  {
    const bareOrigin = "https://widebodies.football.cbssports.com";
    const normalizedOrigin = new URL(bareOrigin).href; // what Chrome's tab.url actually contains
    assert.equal(
      normalizedOrigin,
      "https://widebodies.football.cbssports.com/",
      "WHATWG URL normalization (the same normalization Chrome performs before ever exposing tab.url) always adds the root-path trailing slash"
    );

    assert.equal(
      CBS_URL_PATTERN.test(bareOrigin),
      false,
      "the raw, non-normalized bare-origin string (no trailing slash) is rejected by the current regex"
    );
    assert.equal(
      CBS_URL_PATTERN.test(normalizedOrigin),
      true,
      "the normalized form that Chrome actually delivers via tab.url (with trailing slash) matches the current regex"
    );
  }

  // ── 2/3. Pending CBS connect completes when the tracked tab is already
  //     on the reported live league URL and the FIRST capture attempt
  //     fails (CBSBrowserConnector.captureAll() not ready yet), with NO
  //     second chrome.tabs.onUpdated event ever firing. ──
  {
    const captured = validCapture();
    let attemptCount = 0;

    const harness = loadWorker({
      queryTabs: [],
      getTab(id) {
        return {
          id,
          active: true,
          url: "https://widebodies.football.cbssports.com/"
        };
      },
      sendMessage() {
        attemptCount += 1;
        // First two attempts: message delivery succeeds (content script is
        // attached) but the CBS page's own data is not ready yet.
        if (attemptCount < 3) {
          return { success: false, error: "CBS league data is still loading." };
        }
        return { success: true, data: captured };
      }
    });

    const startResponse = await harness.sendStartMessage();
    assert.equal(startResponse.pending, true);
    assert.equal(harness.updatedListeners.length, 1, "expected one CBS tab update listener");

    const leagueTab = {
      id: 901,
      active: true,
      url: "https://widebodies.football.cbssports.com/"
    };

    // Exactly ONE navigation event -- the same tab settling on the league
    // page. No second onUpdated event is ever fired in this test.
    await harness.updatedListeners[0](
      901,
      { url: leagueTab.url, status: "complete" },
      leagueTab
    );

    await flush();

    assert.equal(
      attemptCount,
      3,
      "capture should retry the application-level {success:false} response, not just message-delivery failures"
    );
    assert.equal(
      harness.storage.pendingCbsConnect,
      undefined,
      "pending CBS state should clear once the bounded retry eventually succeeds"
    );
    assert.ok(
      harness.updatedTabs.some((entry) => entry.id === 77 && entry.options.active === true),
      "Inner Sanctum tab should be refocused once the retried capture succeeds"
    );
  }

  // ── Bounded: retries do not continue forever if the CBS bridge never
  //     becomes ready; the pending state is left for the timeout to
  //     eventually clear rather than looping without limit. ──
  {
    const harness = loadWorker({
      queryTabs: [],
      getTab(id) {
        return {
          id,
          active: true,
          url: "https://widebodies.football.cbssports.com/"
        };
      },
      sendMessage() {
        return { success: false, error: "CBS league data is still loading." };
      }
    });

    await harness.sendStartMessage();

    const leagueTab = {
      id: 901,
      active: true,
      url: "https://widebodies.football.cbssports.com/"
    };

    await harness.updatedListeners[0](
      901,
      { url: leagueTab.url, status: "complete" },
      leagueTab
    );

    await flush();

    assert.equal(
      harness.getSendAttempts(),
      12,
      "retry must be bounded to the fixed retry limit, never unbounded"
    );
    assert.ok(
      harness.storage.pendingCbsConnect,
      "pending state should remain (for the overall timeout to eventually clear) rather than being silently dropped"
    );
  }

  console.log("PASS cbs-pending-capture-retry");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
