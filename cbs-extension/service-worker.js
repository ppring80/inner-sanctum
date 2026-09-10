/*
  THE INNER SANCTUM — CONNECT
  Chrome Extension Service Worker

  VERSION 0.4.0

  Supports browser-assisted, read-only CBS and ESPN league connection.
  Customers authenticate normally on the provider site. The extension
  waits for the selected league page, captures sanitized fantasy data,
  returns it to Inner Sanctum, and never stores provider passwords,
  cookies, session tokens, or authorization headers.
*/

"use strict";

const CBS_URL_PATTERN =
  /^https:\/\/(?!www\.)[^.]+\.football\.cbssports\.com\//i;

const CBS_ENTRY_URL =
  "https://www.cbssports.com/fantasy/football/";

const ESPN_URL_PATTERN =
  /^https:\/\/fantasy\.espn\.com\/football\//i;

const ESPN_ENTRY_URL =
  "https://fantasy.espn.com/football/";

const SANCTUM_URL_PATTERN =
  /^https:\/\/(?:www\.)?theinnersanctum\.xyz\/connect-league/i;

const CBS_PENDING_KEY =
  "pendingConnect";

const ESPN_PENDING_KEY =
  "pendingEspnConnect";

const CONNECT_TIMEOUT_MS =
  10 * 60 * 1000;

const captureInFlight =
  new Set();

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

async function getPending(key) {
  const result =
    await chrome.storage.session.get(key);

  return result?.[key] || null;
}

async function setPending(
  key,
  value
) {
  await chrome.storage.session.set({
    [key]: value
  });
}

async function clearPending(key) {
  await chrome.storage.session.remove(key);
}

async function isSanctumTabStillValid(tabId) {
  try {
    const tab =
      await chrome.tabs.get(tabId);

    return Boolean(
      tab &&
      typeof tab.url === "string" &&
      SANCTUM_URL_PATTERN.test(tab.url)
    );
  } catch (err) {
    return false;
  }
}

async function findActiveProviderLeagueTab(
  urlPattern
) {
  const tabs =
    await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

  return (
    tabs.find(function (tab) {
      return (
        typeof tab.url === "string" &&
        urlPattern.test(tab.url)
      );
    }) || null
  );
}

async function showSanctumStatus(
  sanctumTabId,
  provider,
  type,
  message
) {
  if (
    !(await isSanctumTabStillValid(
      sanctumTabId
    ))
  ) {
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: {
        tabId: sanctumTabId
      },

      world: "MAIN",

      func: function (
        providerName,
        statusType,
        statusMessage
      ) {
        const box =
          document.getElementById(
            providerName + "Result"
          );

        if (!box) {
          return;
        }

        box.className =
          "result-box " +
          statusType +
          " show";

        box.textContent =
          statusMessage;
      },

      args: [
        String(provider),
        String(type || "loading"),
        String(message || "")
      ]
    });
  } catch (err) {
    console.error(
      "Could not display connection status.",
      err
    );
  }
}

async function showSanctumError(
  sanctumTabId,
  provider,
  message
) {
  return showSanctumStatus(
    sanctumTabId,
    provider,
    "error",
    "⚠️ " +
      String(
        message ||
        provider.toUpperCase() +
          " connection failed."
      )
  );
}

async function focusSanctum(tabId) {
  try {
    await chrome.tabs.update(
      tabId,
      { active: true }
    );
  } catch (err) {
    console.warn(
      "League connected, but Inner Sanctum tab could not be focused.",
      err
    );
  }
}

async function sendCaptureRequest(
  tabId,
  messageType,
  provider,
  attempt
) {
  const n = attempt || 1;

  try {
    return await chrome.tabs.sendMessage(
      tabId,
      {
        type: messageType
      }
    );
  } catch (err) {
    if (n >= 3) {
      throw new Error(
        "The " +
        provider.toUpperCase() +
        " page connector is not ready yet."
      );
    }

    await sleep(750);

    return sendCaptureRequest(
      tabId,
      messageType,
      provider,
      n + 1
    );
  }
}

async function deliverCbsToSanctum(
  sanctumTabId,
  captured
) {
  if (
    !(await isSanctumTabStillValid(
      sanctumTabId
    ))
  ) {
    throw new Error(
      "The Inner Sanctum connection page is no longer open. Return to Link Your League and try again."
    );
  }

  return chrome.scripting.executeScript({
    target: {
      tabId: sanctumTabId
    },

    world: "MAIN",

    func: function (payload) {
      if (
        typeof window.receiveCbsConnection !==
        "function"
      ) {
        throw new Error(
          "The Inner Sanctum CBS receiver is not available."
        );
      }

      return window.receiveCbsConnection(
        payload
      );
    },

    args: [captured]
  });
}

async function deliverEspnToSanctum(
  sanctumTabId,
  captured
) {
  if (
    !(await isSanctumTabStillValid(
      sanctumTabId
    ))
  ) {
    throw new Error(
      "The Inner Sanctum connection page is no longer open. Return to Link Your League and try again."
    );
  }

  return chrome.scripting.executeScript({
    target: {
      tabId: sanctumTabId
    },

    world: "MAIN",

    func: function (payload) {
      if (
        !payload ||
        !payload.league ||
        !payload.team ||
        !Array.isArray(payload.roster)
      ) {
        throw new Error(
          "Incomplete ESPN league data was received."
        );
      }

      const scoringFormat =
        payload?.settings?.scoringProfile?.format ||
        payload?.meta?.dataQuality?.scoringFormat ||
        null;

      const connectionData = {
        leagueId:
          payload.league.id,

        leagueName:
          payload.league.name,

        season:
          payload.league.season,

        teamCount:
          payload.league.teamCount,

        teamId:
          payload.team.id,

        teamName:
          payload.team.name,

        scoringFormat,

        private:
          true,

        connectionMode:
          "browser-assisted",

        readOnly:
          true,

        league:
          payload.league,

        team:
          payload.team,

        roster:
          payload.roster,

        standings:
          payload.standings || [],

        schedule:
          payload.schedule || [],

        matchup:
          payload.matchup || null,

        settings:
          payload.settings || null,

        meta:
          payload.meta || null,

        syncedAt:
          new Date().toISOString()
      };

      if (
        !window.LeagueConnection ||
        typeof window.LeagueConnection.connect !==
          "function"
      ) {
        throw new Error(
          "The Inner Sanctum league connection manager is unavailable."
        );
      }

      const isConnected =
        typeof window.LeagueConnection.isConnected ===
          "function" &&
        window.LeagueConnection.isConnected(
          "espn"
        );

      if (isConnected) {
        if (
          typeof window.LeagueConnection.update !==
          "function"
        ) {
          throw new Error(
            "The Inner Sanctum league connection updater is unavailable."
          );
        }

        window.LeagueConnection.update(
          "espn",
          connectionData
        );
      } else {
        window.LeagueConnection.connect(
          "espn",
          connectionData
        );
      }

      if (
        typeof window.selectedProvider !==
        "undefined"
      ) {
        window.selectedProvider = "espn";
      }

      if (
        typeof window.renderPlatformRow ===
        "function"
      ) {
        window.renderPlatformRow();
      }

      if (
        typeof window.renderConnectedBanner ===
        "function"
      ) {
        window.renderConnectedBanner();
      }

      if (
        typeof window.renderProviderForm ===
        "function"
      ) {
        window.renderProviderForm();
      }

      if (
        typeof window.renderChatGptLinkPanel ===
        "function"
      ) {
        window.renderChatGptLinkPanel();
      }

      if (
        typeof window.refreshChatGptLinkIfNeeded ===
        "function"
      ) {
        window.refreshChatGptLinkIfNeeded(
          "espn"
        );
      }

      const box =
        document.getElementById(
          "espnResult"
        );

      if (box) {
        box.className =
          "result-box success show";

        box.textContent =
          "✓ " +
          (connectionData.leagueName ||
            "ESPN league") +
          " connected — " +
          (connectionData.teamName ||
            "team identified") +
          ".";
      }

      return connectionData;
    },

    args: [captured]
  });
}

async function captureCbsFromLeagueTab(
  cbsTab,
  sanctumTabId
) {
  if (
    !cbsTab?.id ||
    !CBS_URL_PATTERN.test(cbsTab.url || "")
  ) {
    throw new Error(
      "CBS has not reached a fantasy league page yet."
    );
  }

  await showSanctumStatus(
    sanctumTabId,
    "cbs",
    "loading",
    "🔵 CBS league detected. Syncing league, roster, standings, schedule and scoring..."
  );

  await sleep(300);

  const response =
    await sendCaptureRequest(
      cbsTab.id,
      "INNER_SANCTUM_CBS_CAPTURE",
      "cbs",
      1
    );

  if (
    !response ||
    response.success !== true
  ) {
    throw new Error(
      response?.error ||
      "CBS league capture is not ready yet."
    );
  }

  const captured =
    response.data;

  if (
    !captured?.league?.id ||
    !captured?.team?.id
  ) {
    throw new Error(
      "CBS has not exposed a complete league/team identity yet."
    );
  }

  if (
    captured.meta?.dataQuality &&
    captured.meta.dataQuality.complete === false
  ) {
    throw new Error(
      "CBS league data is still incomplete."
    );
  }

  await deliverCbsToSanctum(
    sanctumTabId,
    captured
  );

  return {
    success: true,
    leagueName:
      captured.league?.name || "",
    teamName:
      captured.team?.name || ""
  };
}

async function captureEspnFromLeagueTab(
  espnTab,
  sanctumTabId
) {
  if (
    !espnTab?.id ||
    !ESPN_URL_PATTERN.test(espnTab.url || "")
  ) {
    throw new Error(
      "ESPN has not reached a fantasy-football page yet."
    );
  }

  let leagueId = "";

  try {
    leagueId =
      new URL(espnTab.url)
        .searchParams
        .get("leagueId") || "";
  } catch (err) {
  }

  if (!leagueId) {
    throw new Error(
      "Open the ESPN league you want to connect."
    );
  }

  await showSanctumStatus(
    sanctumTabId,
    "espn",
    "loading",
    "🔴 ESPN league detected. Syncing your league and team..."
  );

  await sleep(300);

  const response =
    await sendCaptureRequest(
      espnTab.id,
      "INNER_SANCTUM_ESPN_CAPTURE",
      "espn",
      1
    );

  if (
    !response ||
    response.success !== true
  ) {
    throw new Error(
      response?.error ||
      "ESPN league capture is not ready yet."
    );
  }

  const captured =
    response.data;

  if (
    !captured?.league?.id ||
    !captured?.team?.id ||
    !Array.isArray(captured.roster) ||
    !captured.roster.length
  ) {
    throw new Error(
      "ESPN league data is still incomplete."
    );
  }

  if (
    captured.meta?.dataQuality &&
    captured.meta.dataQuality.complete === false
  ) {
    throw new Error(
      "ESPN league data is still loading."
    );
  }

  await deliverEspnToSanctum(
    sanctumTabId,
    captured
  );

  return {
    success: true,
    leagueName:
      captured.league?.name || "",
    teamName:
      captured.team?.name || ""
  };
}

async function openProviderAndWait(
  provider,
  sanctumTabId
) {
  const isCbs =
    provider === "cbs";

  const tab =
    await chrome.tabs.create({
      url:
        isCbs
          ? CBS_ENTRY_URL
          : ESPN_ENTRY_URL,
      active: true
    });

  if (!tab?.id) {
    throw new Error(
      provider.toUpperCase() +
        " could not be opened."
    );
  }

  const key =
    isCbs
      ? CBS_PENDING_KEY
      : ESPN_PENDING_KEY;

  await setPending(
    key,
    {
      sanctumTabId,
      providerTabId: tab.id,
      startedAt: Date.now()
    }
  );

  await showSanctumStatus(
    sanctumTabId,
    provider,
    "loading",
    isCbs
      ? "🔵 CBS opened. Sign in normally and open the league you want to connect — Inner Sanctum will detect it automatically."
      : "🔴 ESPN opened. Sign in normally and open the league you want to connect — Inner Sanctum will detect it automatically."
  );

  return {
    success: true,
    pending: true
  };
}

async function trackExistingProviderTab(
  provider,
  sanctumTabId,
  providerTabId
) {
  const isCbs =
    provider === "cbs";

  const key =
    isCbs
      ? CBS_PENDING_KEY
      : ESPN_PENDING_KEY;

  await setPending(
    key,
    {
      sanctumTabId,
      providerTabId,
      startedAt: Date.now()
    }
  );

  await showSanctumStatus(
    sanctumTabId,
    provider,
    "loading",
    isCbs
      ? "🔵 CBS is open. Open the league you want to connect — Inner Sanctum will detect it automatically."
      : "🔴 ESPN is open. Open the league you want to connect — Inner Sanctum will detect it automatically."
  );

  try {
    await chrome.tabs.update(
      providerTabId,
      { active: true }
    );
  } catch (err) {
    console.warn(
      "Could not focus the existing provider tab.",
      err
    );
  }

  return {
    success: true,
    pending: true
  };
}

async function handleProviderConnect(
  provider,
  sender
) {
  const sanctumTab =
    sender.tab;

  if (
    !sanctumTab ||
    !SANCTUM_URL_PATTERN.test(
      sanctumTab.url || ""
    )
  ) {
    throw new Error(
      "Connection request did not originate from The Inner Sanctum."
    );
  }

  const isCbs =
    provider === "cbs";

  const activeTab =
    await findActiveProviderLeagueTab(
      isCbs
        ? CBS_URL_PATTERN
        : ESPN_URL_PATTERN
    );

  if (activeTab) {
    try {
      await clearPending(
        isCbs
          ? CBS_PENDING_KEY
          : ESPN_PENDING_KEY
      );

      return isCbs
        ? await captureCbsFromLeagueTab(
            activeTab,
            sanctumTab.id
          )
        : await captureEspnFromLeagueTab(
            activeTab,
            sanctumTab.id
          );
    } catch (err) {
      console.warn(
        "Active provider tab was not ready; tracking it until the selected league is opened.",
        err
      );

      return trackExistingProviderTab(
        provider,
        sanctumTab.id,
        activeTab.id
      );
    }
  }

  return openProviderAndWait(
    provider,
    sanctumTab.id
  );
}

async function handleTrackedNavigation(
  provider,
  tabId,
  changeInfo,
  tab
) {
  const isCbs =
    provider === "cbs";

  const pendingKey =
    isCbs
      ? CBS_PENDING_KEY
      : ESPN_PENDING_KEY;

  const pending =
    await getPending(pendingKey);

  if (
    !pending ||
    tabId !== pending.providerTabId
  ) {
    return;
  }

  if (
    Date.now() -
      Number(
        pending.startedAt || 0
      ) >
    CONNECT_TIMEOUT_MS
  ) {
    await clearPending(pendingKey);

    await showSanctumError(
      pending.sanctumTabId,
      provider,
      provider.toUpperCase() +
        " sign-in timed out. Click Connect again."
    );

    return;
  }

  const navigationSignal =
    changeInfo.status === "complete" ||
    Boolean(changeInfo.url);

  if (!navigationSignal) {
    return;
  }

  const currentUrl =
    tab?.url ||
    changeInfo.url ||
    "";

  const matchesProvider =
    isCbs
      ? CBS_URL_PATTERN.test(currentUrl)
      : ESPN_URL_PATTERN.test(currentUrl);

  if (!matchesProvider) {
    return;
  }

  const flightKey =
    provider + ":" + tabId;

  if (captureInFlight.has(flightKey)) {
    return;
  }

  captureInFlight.add(flightKey);

  try {
    const liveTab =
      tab?.id
        ? tab
        : await chrome.tabs.get(tabId);

    if (isCbs) {
      await captureCbsFromLeagueTab(
        liveTab,
        pending.sanctumTabId
      );
    } else {
      await captureEspnFromLeagueTab(
        liveTab,
        pending.sanctumTabId
      );
    }

    await clearPending(pendingKey);

    await focusSanctum(
      pending.sanctumTabId
    );
  } catch (err) {
    console.warn(
      provider.toUpperCase() +
        " capture not ready yet:",
      err?.message || err
    );
  } finally {
    captureInFlight.delete(flightKey);
  }
}

chrome.tabs.onUpdated.addListener(
  function (
    tabId,
    changeInfo,
    tab
  ) {
    handleTrackedNavigation(
      "cbs",
      tabId,
      changeInfo,
      tab
    ).catch(function (err) {
      console.error(
        "CBS navigation handler failed:",
        err
      );
    });

    handleTrackedNavigation(
      "espn",
      tabId,
      changeInfo,
      tab
    ).catch(function (err) {
      console.error(
        "ESPN navigation handler failed:",
        err
      );
    });
  }
);

chrome.tabs.onRemoved.addListener(
  function (tabId) {
    Promise.all([
      getPending(CBS_PENDING_KEY),
      getPending(ESPN_PENDING_KEY)
    ])
      .then(async function (pendingStates) {
        const providers = [
          "cbs",
          "espn"
        ];

        for (
          let i = 0;
          i < pendingStates.length;
          i += 1
        ) {
          const pending =
            pendingStates[i];

          if (!pending) {
            continue;
          }

          const provider =
            providers[i];

          const key =
            provider === "cbs"
              ? CBS_PENDING_KEY
              : ESPN_PENDING_KEY;

          if (
            tabId === pending.providerTabId
          ) {
            await clearPending(key);

            await showSanctumError(
              pending.sanctumTabId,
              provider,
              "The " +
                provider.toUpperCase() +
                " tab was closed before the league connected. Click Connect again."
            );
          } else if (
            tabId === pending.sanctumTabId
          ) {
            await clearPending(key);
          }
        }
      })
      .catch(function (err) {
        console.error(
          "Connector tab-close cleanup failed:",
          err
        );
      });
  }
);

chrome.runtime.onMessage.addListener(
  function (
    message,
    sender,
    sendResponse
  ) {
    let provider = null;

    if (
      message?.type ===
      "INNER_SANCTUM_START_CBS_CONNECT"
    ) {
      provider = "cbs";
    } else if (
      message?.type ===
      "INNER_SANCTUM_START_ESPN_CONNECT"
    ) {
      provider = "espn";
    } else {
      return;
    }

    handleProviderConnect(
      provider,
      sender
    )
      .then(function (result) {
        sendResponse(result);
      })
      .catch(async function (err) {
        console.error(
          provider.toUpperCase() +
            " Connect failed:",
          err
        );

        if (sender.tab?.id) {
          await showSanctumError(
            sender.tab.id,
            provider,
            err.message
          );
        }

        sendResponse({
          success: false,
          error:
            err.message ||
            provider.toUpperCase() +
              " connection failed."
        });
      });

    return true;
  }
);
