/*
  THE INNER SANCTUM — CONNECT v0.5.0

  Keeps the proven CBS service worker intact and layers ESPN browser-assisted
  connection on top. MAIN-world provider scripts are injected on demand so the
  same connector path works in Chromium and Safari.
*/

"use strict";

importScripts("service-worker.js");

const extensionApi = globalThis.browser || globalThis.chrome;
const ESPN_V050_URL_PATTERN = /^https:\/\/fantasy\.espn\.com\/football\//i;
const ESPN_V050_SANCTUM_URL_PATTERN = /^https:\/\/(?:www\.)?theinnersanctum\.xyz\/connect-league/i;
const ESPN_V050_ENTRY_URL = "https://fantasy.espn.com/football/welcome";
const ESPN_V050_PENDING_KEY = "pendingEspnConnect";
const ESPN_V050_CONNECT_TIMEOUT_MS = 10 * 60 * 1000;
const espnCaptureInFlight = new Set();

async function getPendingEspn() {
  const result = await extensionApi.storage.session.get(ESPN_V050_PENDING_KEY);
  return result?.[ESPN_V050_PENDING_KEY] || null;
}

async function setPendingEspn(value) {
  await extensionApi.storage.session.set({ [ESPN_V050_PENDING_KEY]: value });
}

async function clearPendingEspn() {
  await extensionApi.storage.session.remove(ESPN_V050_PENDING_KEY);
}

async function isEspnSanctumTabStillValid(tabId) {
  try {
    const tab = await extensionApi.tabs.get(tabId);
    return Boolean(tab && typeof tab.url === "string" && ESPN_V050_SANCTUM_URL_PATTERN.test(tab.url));
  } catch (err) {
    return false;
  }
}

async function showEspnStatus(sanctumTabId, type, message) {
  if (!(await isEspnSanctumTabStillValid(sanctumTabId))) return;

  try {
    await extensionApi.scripting.executeScript({
      target: { tabId: sanctumTabId },
      world: "MAIN",
      func: function (statusType, statusMessage) {
        const box = document.getElementById("espnResult");
        if (!box) return;
        box.className = "result-box " + statusType + " show";
        box.textContent = statusMessage;
      },
      args: [String(type || "loading"), String(message || "")]
    });
  } catch (err) {
    console.warn("Could not display ESPN connection status.", err);
  }
}

async function injectEspnMainWorld(tabId) {
  await extensionApi.scripting.executeScript({
    target: { tabId: tabId },
    world: "MAIN",
    files: ["espn-main-bridge.js"]
  });
}

async function deliverEspnToSanctum(sanctumTabId, captured) {
  if (!(await isEspnSanctumTabStillValid(sanctumTabId))) {
    throw new Error("The Inner Sanctum connection page is no longer open. Return to Link Your League and try again.");
  }

  return extensionApi.scripting.executeScript({
    target: { tabId: sanctumTabId },
    world: "MAIN",
    func: function (payload) {
      if (!payload || !payload.league || !payload.team || !Array.isArray(payload.roster) || !payload.roster.length) {
        throw new Error("Incomplete ESPN league data was received.");
      }

      const connectionData = {
        leagueId: payload.league.id,
        leagueName: payload.league.name,
        season: payload.league.season,
        teamCount: payload.league.teamCount,
        teamId: payload.team.id,
        teamName: payload.team.name,
        private: true,
        connectionMode: "browser-assisted",
        readOnly: true,
        league: payload.league,
        team: payload.team,
        roster: payload.roster,
        standings: payload.standings || [],
        schedule: payload.schedule || [],
        matchup: payload.matchup || null,
        settings: payload.settings || null,
        meta: payload.meta || null,
        syncedAt: new Date().toISOString()
      };

      const scoringFormat =
        payload?.settings?.scoringProfile?.format ||
        payload?.meta?.dataQuality?.scoringFormat ||
        null;

      if (scoringFormat) connectionData.scoringFormat = scoringFormat;

      if (!window.LeagueConnection || typeof window.LeagueConnection.connect !== "function") {
        throw new Error("The Inner Sanctum league connection manager is unavailable.");
      }

      const alreadyConnected =
        typeof window.LeagueConnection.isConnected === "function" &&
        window.LeagueConnection.isConnected("espn");

      if (alreadyConnected && typeof window.LeagueConnection.update === "function") {
        window.LeagueConnection.update("espn", connectionData);
      } else {
        window.LeagueConnection.connect("espn", connectionData);
      }

      if (typeof window.selectedProvider !== "undefined") window.selectedProvider = "espn";
      if (typeof window.renderPlatformRow === "function") window.renderPlatformRow();
      if (typeof window.renderConnectedBanner === "function") window.renderConnectedBanner();
      if (typeof window.renderProviderForm === "function") window.renderProviderForm();
      if (typeof window.renderChatGptLinkPanel === "function") window.renderChatGptLinkPanel();
      if (typeof window.refreshChatGptLinkIfNeeded === "function") window.refreshChatGptLinkIfNeeded("espn");

      const box = document.getElementById("espnResult");
      if (box) {
        box.className = "result-box success show";
        box.textContent = "✓ " + (connectionData.leagueName || "ESPN league") +
          " connected — " + (connectionData.teamName || "team identified") + ".";
      }

      return connectionData;
    },
    args: [captured]
  });
}

async function sendEspnCapture(tabId, attempt) {
  const n = attempt || 1;
  try {
    return await extensionApi.tabs.sendMessage(tabId, { type: "INNER_SANCTUM_ESPN_CAPTURE" });
  } catch (err) {
    if (n >= 3) throw new Error("The ESPN page connector is not ready yet.");
    await new Promise(function (resolve) { setTimeout(resolve, 750); });
    return sendEspnCapture(tabId, n + 1);
  }
}

async function captureEspnFromLeagueTab(espnTab, sanctumTabId) {
  if (!espnTab?.id || !ESPN_V050_URL_PATTERN.test(espnTab.url || "")) {
    throw new Error("ESPN has not reached a fantasy-football page yet.");
  }

  let leagueId = "";
  try {
    leagueId = new URL(espnTab.url).searchParams.get("leagueId") || "";
  } catch (err) {}

  if (!leagueId) {
    throw new Error("Open the ESPN league you want to connect.");
  }

  await showEspnStatus(
    sanctumTabId,
    "loading",
    "🔴 ESPN league detected. Syncing your league, team and roster..."
  );

  // Safari cannot preload this script through manifest `world: MAIN`.
  // Inject it explicitly immediately before the isolated bridge requests capture.
  await injectEspnMainWorld(espnTab.id);

  const response = await sendEspnCapture(espnTab.id, 1);
  if (!response || response.success !== true) {
    throw new Error(response?.error || "ESPN league capture is not ready yet.");
  }

  const captured = response.data;
  if (!captured?.league?.id || !captured?.team?.id || !Array.isArray(captured.roster) || !captured.roster.length) {
    throw new Error("ESPN league data is still incomplete.");
  }

  if (captured.meta?.dataQuality?.complete === false) {
    throw new Error("ESPN league data is still loading.");
  }

  await deliverEspnToSanctum(sanctumTabId, captured);
  return {
    success: true,
    leagueName: captured.league?.name || "",
    teamName: captured.team?.name || ""
  };
}

async function findOpenEspnLeagueTab() {
  const tabs = await extensionApi.tabs.query({});
  const espnTabs = tabs.filter(function (tab) {
    return typeof tab.url === "string" && ESPN_V050_URL_PATTERN.test(tab.url);
  });

  const withLeague = espnTabs.find(function (tab) {
    try {
      return Boolean(new URL(tab.url).searchParams.get("leagueId"));
    } catch (err) {
      return false;
    }
  });

  return withLeague || espnTabs.find(function (tab) { return tab.active; }) || espnTabs[0] || null;
}

async function beginEspnConnect(sender) {
  const sanctumTab = sender.tab;
  if (!sanctumTab || !ESPN_V050_SANCTUM_URL_PATTERN.test(sanctumTab.url || "")) {
    throw new Error("ESPN connection request did not originate from The Inner Sanctum.");
  }

  const existing = await findOpenEspnLeagueTab();
  if (existing) {
    try {
      return await captureEspnFromLeagueTab(existing, sanctumTab.id);
    } catch (err) {
      await setPendingEspn({
        sanctumTabId: sanctumTab.id,
        providerTabId: existing.id,
        startedAt: Date.now()
      });
      await extensionApi.tabs.update(existing.id, { active: true });
      await showEspnStatus(
        sanctumTab.id,
        "loading",
        "🔴 ESPN is open. Sign in if needed and open the league you want — Inner Sanctum will connect automatically."
      );
      return { success: true, pending: true };
    }
  }

  const tab = await extensionApi.tabs.create({ url: ESPN_V050_ENTRY_URL, active: true });
  if (!tab?.id) throw new Error("ESPN could not be opened.");

  await setPendingEspn({
    sanctumTabId: sanctumTab.id,
    providerTabId: tab.id,
    startedAt: Date.now()
  });

  await showEspnStatus(
    sanctumTab.id,
    "loading",
    "🔴 ESPN opened. Sign in normally and open the league you want — Inner Sanctum will detect it automatically."
  );

  return { success: true, pending: true };
}

extensionApi.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message?.type !== "INNER_SANCTUM_START_ESPN_CONNECT") return;

  beginEspnConnect(sender)
    .then(function (result) { sendResponse(result); })
    .catch(async function (err) {
      if (sender.tab?.id) {
        await showEspnStatus(sender.tab.id, "error", "⚠️ " + (err.message || "ESPN connection failed."));
      }
      sendResponse({ success: false, error: err.message || "ESPN connection failed." });
    });

  return true;
});

extensionApi.tabs.onUpdated.addListener(async function (tabId, changeInfo, tab) {
  const pending = await getPendingEspn();
  if (!pending) return;

  if (Date.now() - Number(pending.startedAt || 0) > ESPN_V050_CONNECT_TIMEOUT_MS) {
    await clearPendingEspn();
    await showEspnStatus(
      pending.sanctumTabId,
      "error",
      "⚠️ ESPN sign-in timed out. Click Connect ESPN League and try again."
    );
    return;
  }

  const currentUrl = tab?.url || changeInfo.url || "";
  if (!ESPN_V050_URL_PATTERN.test(currentUrl)) return;

  let hasLeagueId = false;
  try {
    hasLeagueId = Boolean(new URL(currentUrl).searchParams.get("leagueId"));
  } catch (err) {}

  if (!hasLeagueId) return;

  if (pending.providerTabId !== tabId) {
    await setPendingEspn({ ...pending, providerTabId: tabId });
  }

  const flightKey = String(tabId);
  if (espnCaptureInFlight.has(flightKey)) return;
  espnCaptureInFlight.add(flightKey);

  try {
    const liveTab = tab?.id ? tab : await extensionApi.tabs.get(tabId);
    await captureEspnFromLeagueTab(liveTab, pending.sanctumTabId);
    await clearPendingEspn();
    try {
      await extensionApi.tabs.update(pending.sanctumTabId, { active: true });
    } catch (err) {}
  } catch (err) {
    console.warn("ESPN capture not ready yet:", err?.message || err);
  } finally {
    espnCaptureInFlight.delete(flightKey);
  }
});
