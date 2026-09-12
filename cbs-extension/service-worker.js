/*
  THE INNER SANCTUM — CBS CONNECT
  Chrome Extension Service Worker

  VERSION 0.1.1

  RESPONSIBILITY
  ------------------------------------------------
  Coordinates communication between:

    Inner Sanctum connect-league page
          ↓
    extension
          ↓
    authenticated CBS Fantasy tab
          ↓
    CBSBrowserConnector.captureAll()
          ↓
    extension
          ↓
    window.receiveCbsConnection(...)
          ↓
    LeagueConnection

  SECURITY
  ------------------------------------------------
  This worker never requests or stores:

    - CBS password
    - CBS cookies
    - CBS session tokens
    - authorization headers

  Only the sanitized result returned by
  CBSBrowserConnector.captureAll() travels through the extension.
*/

"use strict";

const CBS_URL_PATTERN =
  /^https:\/\/[^.]+\.football\.cbssports\.com\//i;

const CBS_ENTRY_URL =
  "https://www.cbssports.com/fantasy/football/";

const SANCTUM_URL_PATTERN =
  /^https:\/\/(?:www\.)?theinnersanctum\.xyz\/connect-league/i;

const CBS_PENDING_KEY =
  "pendingCbsConnect";

const CBS_CONNECT_TIMEOUT_MS =
  10 * 60 * 1000;

const cbsCaptureInFlight =
  new Set();

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

async function getPendingCbs() {
  const result =
    await chrome.storage.session.get(
      CBS_PENDING_KEY
    );

  return result?.[CBS_PENDING_KEY] || null;
}

async function setPendingCbs(value) {
  await chrome.storage.session.set({
    [CBS_PENDING_KEY]: value
  });
}

async function clearPendingCbs() {
  await chrome.storage.session.remove(
    CBS_PENDING_KEY
  );
}

/*
  Find an open CBS Fantasy league tab.

  If multiple CBS tabs exist, prefer the active one.
*/

async function findCbsTab() {
  const tabs =
    await chrome.tabs.query({});

  const cbsTabs =
    tabs.filter(function (tab) {
      return (
        typeof tab.url === "string" &&
        CBS_URL_PATTERN.test(tab.url)
      );
    });

  if (!cbsTabs.length) {
    return null;
  }

  const active =
    cbsTabs.find(function (tab) {
      return tab.active;
    });

  return active || cbsTabs[0];
}

/*
  Send sanitized captured data directly into the
  MAIN world of the Inner Sanctum connection page.
*/

async function deliverToSanctum(
  sanctumTabId,
  captured
) {
  const results =
    await chrome.scripting.executeScript({
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

      args: [
        captured
      ]
    });

  return results;
}

async function showSanctumStatus(
  sanctumTabId,
  type,
  message
) {
  try {
    await chrome.scripting.executeScript({
      target: {
        tabId: sanctumTabId
      },

      world: "MAIN",

      func: function (
        statusType,
        statusMessage
      ) {
        const box =
          document.getElementById(
            "cbsResult"
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
        String(type || "loading"),
        String(message || "")
      ]
    });
  } catch (err) {
    console.error(
      "Could not display CBS connection status.",
      err
    );
  }
}

async function showSanctumError(
  sanctumTabId,
  message
) {
  return showSanctumStatus(
    sanctumTabId,
    "error",
    "⚠️ " +
      String(
        message ||
        "CBS connection failed."
      )
  );
}

async function sendCbsCaptureRequest(
  tabId,
  attempt
) {
  const n = attempt || 1;

  try {
    return await chrome.tabs.sendMessage(
      tabId,
      {
        type:
          "INNER_SANCTUM_CBS_CAPTURE"
      }
    );
  } catch (err) {
    if (n >= 3) {
      throw new Error(
        "The CBS page connector is not ready yet."
      );
    }

    await sleep(750);

    return sendCbsCaptureRequest(
      tabId,
      n + 1
    );
  }
}

async function captureCbsFromLeagueTab(
  cbsTab,
  sanctumTabId
) {
  if (
    !cbsTab?.id ||
    !CBS_URL_PATTERN.test(
      cbsTab.url || ""
    )
  ) {
    throw new Error(
      "CBS has not reached a fantasy league page yet."
    );
  }

  await showSanctumStatus(
    sanctumTabId,
    "loading",
    "🔵 CBS league detected. Syncing league, roster, standings, schedule and scoring..."
  );

  const response =
    await sendCbsCaptureRequest(
      cbsTab.id,
      1
    );

  if (
    !response ||
    response.success !== true
  ) {
    throw new Error(
      response?.error ||
      "CBS league capture failed."
    );
  }

  const captured =
    response.data;

  if (
    !captured ||
    typeof captured !== "object"
  ) {
    throw new Error(
      "CBS returned no league data."
    );
  }

  if (
    !captured.league?.id ||
    !captured.team?.id
  ) {
    throw new Error(
      "CBS league or team identity could not be confirmed."
    );
  }

  if (
    captured.meta?.dataQuality &&
    captured.meta.dataQuality.complete === false
  ) {
    throw new Error(
      "CBS league data was incomplete. Refresh your CBS league page and try again."
    );
  }

  await deliverToSanctum(
    sanctumTabId,
    captured
  );

  return {
    success: true,

    leagueName:
      captured.league?.name ||
      "",

    teamName:
      captured.team?.name ||
      ""
  };
}

async function openCbsAndWait(
  sanctumTabId
) {
  const tab =
    await chrome.tabs.create({
      url: CBS_ENTRY_URL,
      active: true
    });

  if (!tab?.id) {
    throw new Error(
      "CBS could not be opened."
    );
  }

  await setPendingCbs({
    sanctumTabId,
    providerTabId: tab.id,
    startedAt: Date.now()
  });

  await showSanctumStatus(
    sanctumTabId,
    "loading",
    "🔵 CBS opened. Sign in normally and open the league you want to connect — Inner Sanctum will detect it automatically."
  );

  return {
    success: true,
    pending: true
  };
}

/*
  CBS capture request.

  Triggered by the Inner Sanctum content bridge.
*/

async function handleCbsConnect(
  message,
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
      "CBS connection request did not originate from The Inner Sanctum."
    );
  }

  const cbsTab =
    await findCbsTab();

  if (!cbsTab) {
    return openCbsAndWait(
      sanctumTab.id
    );
  }

  try {
    return await captureCbsFromLeagueTab(
      cbsTab,
      sanctumTab.id
    );
  } catch (err) {
    await setPendingCbs({
      sanctumTabId: sanctumTab.id,
      providerTabId: cbsTab.id,
      startedAt: Date.now()
    });

    try {
      await chrome.tabs.update(
        cbsTab.id,
        { active: true }
      );
    } catch (focusErr) {
    }

    await showSanctumStatus(
      sanctumTab.id,
      "loading",
      "🔵 CBS is open. Sign in if needed and open the league you want — Inner Sanctum will connect automatically."
    );

    return {
      success: true,
      pending: true
    };
  }
}

/*
  Message router.
*/

chrome.runtime.onMessage.addListener(
  function (
    message,
    sender,
    sendResponse
  ) {
    if (
      message?.type !==
      "INNER_SANCTUM_START_CBS_CONNECT"
    ) {
      return;
    }

    handleCbsConnect(
      message,
      sender
    )
      .then(function (result) {
        sendResponse(
          result
        );
      })
      .catch(async function (err) {
        console.error(
          "CBS Connect failed:",
          err
        );

        if (sender.tab?.id) {
          await showSanctumError(
            sender.tab.id,
            err.message
          );
        }

        sendResponse({
          success: false,
          error:
            err.message ||
            "CBS connection failed."
        });
      });

    return true;
  }
);

chrome.tabs.onUpdated.addListener(
  async function (
    tabId,
    changeInfo,
    tab
  ) {
    const pending =
      await getPendingCbs();

    if (!pending) {
      return;
    }

    if (
      Date.now() -
        Number(
          pending.startedAt || 0
        ) >
      CBS_CONNECT_TIMEOUT_MS
    ) {
      await clearPendingCbs();
      await showSanctumError(
        pending.sanctumTabId,
        "CBS sign-in timed out. Click Connect CBS League and try again."
      );
      return;
    }

    if (
      pending.providerTabId !== tabId
    ) {
      return;
    }

    const currentUrl =
      tab?.url ||
      changeInfo.url ||
      "";

    if (
      !CBS_URL_PATTERN.test(
        currentUrl
      )
    ) {
      return;
    }

    const flightKey =
      String(tabId);

    if (
      cbsCaptureInFlight.has(
        flightKey
      )
    ) {
      return;
    }

    cbsCaptureInFlight.add(
      flightKey
    );

    try {
      const liveTab =
        tab?.id
          ? tab
          : await chrome.tabs.get(
              tabId
            );

      await captureCbsFromLeagueTab(
        liveTab,
        pending.sanctumTabId
      );

      await clearPendingCbs();

      try {
        await chrome.tabs.update(
          pending.sanctumTabId,
          { active: true }
        );
      } catch (focusErr) {
      }
    } catch (err) {
      console.warn(
        "CBS capture not ready yet:",
        err?.message || err
      );
    } finally {
      cbsCaptureInFlight.delete(
        flightKey
      );
    }
  }
);
