/*
  THE INNER SANCTUM — CBS CONNECT
  Chrome Extension Service Worker

  VERSION 0.3.0

  CUSTOMER FLOW
  ------------------------------------------------
  1. Customer clicks Connect CBS League in Inner Sanctum.
  2. If an unambiguous active CBS league tab is already open, capture it.
  3. Otherwise open CBS Fantasy and wait while the customer signs in.
  4. Keep waiting through login / hub / league-picker navigation.
  5. When the tracked CBS tab reaches a real league page, capture it.
  6. Deliver the sanitized league snapshot back to Inner Sanctum.

  No bookmark, password copy, cookie copy, or second Connect click is needed.

  SECURITY
  ------------------------------------------------
  This worker never requests or stores CBS passwords, cookies, session
  tokens, authorization headers, or any other CBS authentication secret.
  chrome.storage.session contains only tab IDs and a start timestamp.
*/

"use strict";

const CBS_URL_PATTERN =
  /^https:\/\/(?!www\.)[^.]+\.football\.cbssports\.com\//i;

const CBS_ENTRY_URL =
  "https://www.cbssports.com/fantasy/football/";

const SANCTUM_URL_PATTERN =
  /^https:\/\/(?:www\.)?theinnersanctum\.xyz\/connect-league/i;

const PENDING_KEY =
  "pendingConnect";

const CONNECT_TIMEOUT_MS =
  10 * 60 * 1000;

const captureInFlight =
  new Set();

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

async function getPendingConnect() {
  const result =
    await chrome.storage.session.get(PENDING_KEY);

  return result?.[PENDING_KEY] || null;
}

async function setPendingConnect(value) {
  await chrome.storage.session.set({
    [PENDING_KEY]: value
  });
}

async function clearPendingConnect() {
  await chrome.storage.session.remove(PENDING_KEY);
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

async function findActiveCbsLeagueTab() {
  const tabs =
    await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

  const active =
    tabs.find(function (tab) {
      return (
        typeof tab.url === "string" &&
        CBS_URL_PATTERN.test(tab.url)
      );
    });

  return active || null;
}

async function deliverToSanctum(
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

async function showSanctumStatus(
  sanctumTabId,
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
  cbsTabId,
  attempt
) {
  const n = attempt || 1;

  try {
    return await chrome.tabs.sendMessage(
      cbsTabId,
      {
        type:
          "INNER_SANCTUM_CBS_CAPTURE"
      }
    );
  } catch (err) {
    if (n >= 2) {
      throw new Error(
        "The CBS page bridge did not respond yet."
      );
    }

    await sleep(750);

    return sendCbsCaptureRequest(
      cbsTabId,
      n + 1
    );
  }
}

async function captureFromLeagueTab(
  cbsTab,
  sanctumTabId
) {
  if (
    !cbsTab ||
    !cbsTab.id ||
    !CBS_URL_PATTERN.test(cbsTab.url || "")
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

  await sleep(300);

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
      "CBS league capture is not ready yet."
    );
  }

  const captured =
    response.data;

  if (
    !captured ||
    typeof captured !== "object"
  ) {
    throw new Error(
      "CBS returned no league data yet."
    );
  }

  if (
    !captured.league?.id ||
    !captured.team?.id
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

  await deliverToSanctum(
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

  await setPendingConnect({
    sanctumTabId,
    cbsTabId: tab.id,
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

  const activeCbsTab =
    await findActiveCbsLeagueTab();

  if (activeCbsTab) {
    try {
      await clearPendingConnect();

      return await captureFromLeagueTab(
        activeCbsTab,
        sanctumTab.id
      );
    } catch (err) {
      console.warn(
        "Active CBS tab was not ready for capture; opening the CBS flow.",
        err
      );
    }
  }

  return openCbsAndWait(
    sanctumTab.id
  );
}

async function handleTrackedCbsNavigation(
  tabId,
  changeInfo,
  tab
) {
  const pending =
    await getPendingConnect();

  if (
    !pending ||
    tabId !== pending.cbsTabId
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
    await clearPendingConnect();

    await showSanctumError(
      pending.sanctumTabId,
      "CBS sign-in timed out. Click Connect CBS again."
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

  if (!CBS_URL_PATTERN.test(currentUrl)) {
    return;
  }

  if (captureInFlight.has(tabId)) {
    return;
  }

  captureInFlight.add(tabId);

  try {
    const liveTab =
      tab?.id
        ? tab
        : await chrome.tabs.get(tabId);

    await captureFromLeagueTab(
      liveTab,
      pending.sanctumTabId
    );

    await clearPendingConnect();

    try {
      await chrome.tabs.update(
        pending.sanctumTabId,
        { active: true }
      );
    } catch (err) {
      console.warn(
        "CBS connected, but Inner Sanctum tab could not be focused.",
        err
      );
    }
  } catch (err) {
    /*
      Do not clear pending state here. During real CBS login the tracked
      tab may pass through a hub or partially loaded league route before
      the actual league page is ready. The next navigation/update should
      get another chance. The overall 10-minute timeout prevents endless
      retries if the user abandons the flow.
    */
    console.warn(
      "CBS capture not ready yet:",
      err?.message || err
    );
  } finally {
    captureInFlight.delete(tabId);
  }
}

chrome.tabs.onUpdated.addListener(
  function (
    tabId,
    changeInfo,
    tab
  ) {
    handleTrackedCbsNavigation(
      tabId,
      changeInfo,
      tab
    ).catch(function (err) {
      console.error(
        "CBS navigation handler failed:",
        err
      );
    });
  }
);

chrome.tabs.onRemoved.addListener(
  function (tabId) {
    getPendingConnect()
      .then(async function (pending) {
        if (!pending) {
          return;
        }

        if (
          tabId === pending.cbsTabId
        ) {
          await clearPendingConnect();

          await showSanctumError(
            pending.sanctumTabId,
            "The CBS tab was closed before the league connected. Click Connect CBS again."
          );

          return;
        }

        if (
          tabId === pending.sanctumTabId
        ) {
          await clearPendingConnect();
        }
      })
      .catch(function (err) {
        console.error(
          "CBS tab-close cleanup failed:",
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
        sendResponse(result);
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
