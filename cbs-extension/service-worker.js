/*
  THE INNER SANCTUM — CBS CONNECT
  Chrome Extension Service Worker

  VERSION 0.2.0

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

  CUSTOMER FLOW
  ------------------------------------------------
  1. Customer clicks Connect CBS League in Inner Sanctum.
  2. If an authenticated CBS league tab is already open, capture it now.
  3. Otherwise open CBS Fantasy and wait while the customer signs in.
  4. As soon as that CBS tab reaches a *.football.cbssports.com league,
     capture it automatically and deliver it back to Inner Sanctum.

  No bookmark, password copy, cookie copy, or second Connect click is needed.

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

/*
  One in-flight customer handoff is enough for the beta extension.
  This object intentionally contains tab IDs only — no CBS credentials,
  cookies, tokens, or page data are retained here.
*/
let pendingConnect = null;

function clearPendingConnect() {
  pendingConnect = null;
}

async function findCbsTab() {
  const tabs = await chrome.tabs.query({});

  const cbsTabs = tabs.filter(function (tab) {
    return (
      typeof tab.url === "string" &&
      CBS_URL_PATTERN.test(tab.url)
    );
  });

  if (!cbsTabs.length) {
    return null;
  }

  const active = cbsTabs.find(function (tab) {
    return tab.active;
  });

  return active || cbsTabs[0];
}

async function deliverToSanctum(
  sanctumTabId,
  captured
) {
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
  try {
    await chrome.scripting.executeScript({
      target: {
        tabId: sanctumTabId
      },

      world: "MAIN",

      func: function (statusType, statusMessage) {
        const box = document.getElementById("cbsResult");

        if (!box) {
          return;
        }

        box.className =
          "result-box " +
          statusType +
          " show";

        box.textContent = statusMessage;
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
      "Open your CBS Fantasy Football league and try again."
    );
  }

  await showSanctumStatus(
    sanctumTabId,
    "loading",
    "🔵 CBS league detected. Syncing league, roster, standings, schedule and scoring..."
  );

  /*
    Give document_idle content scripts a brief chance to finish loading
    after a navigation before asking the isolated bridge for a capture.
  */
  await new Promise(function (resolve) {
    setTimeout(resolve, 500);
  });

  const response = await chrome.tabs.sendMessage(
    cbsTab.id,
    {
      type:
        "INNER_SANCTUM_CBS_CAPTURE"
    }
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

  const captured = response.data;

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
  const tab = await chrome.tabs.create({
    url: CBS_ENTRY_URL,
    active: true
  });

  if (!tab?.id) {
    throw new Error(
      "CBS could not be opened."
    );
  }

  pendingConnect = {
    sanctumTabId,
    cbsTabId: tab.id,
    startedAt: Date.now()
  };

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
  const sanctumTab = sender.tab;

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

  const cbsTab = await findCbsTab();

  if (cbsTab) {
    clearPendingConnect();
    return captureFromLeagueTab(
      cbsTab,
      sanctumTab.id
    );
  }

  return openCbsAndWait(
    sanctumTab.id
  );
}

/*
  Seamless handoff after CBS login/navigation.

  We do not need access to the CBS login page itself. The extension waits
  for the tab it opened to navigate into a league subdomain, where the
  existing CBS content scripts already have host permission and can run.
*/
chrome.tabs.onUpdated.addListener(
  function (tabId, changeInfo, tab) {
    if (!pendingConnect) {
      return;
    }

    if (tabId !== pendingConnect.cbsTabId) {
      return;
    }

    if (changeInfo.status !== "complete") {
      return;
    }

    if (!CBS_URL_PATTERN.test(tab?.url || "")) {
      return;
    }

    const current = pendingConnect;
    clearPendingConnect();

    captureFromLeagueTab(
      tab,
      current.sanctumTabId
    )
      .then(async function () {
        try {
          await chrome.tabs.update(
            current.sanctumTabId,
            { active: true }
          );
        } catch (err) {
          console.warn(
            "CBS connected, but Inner Sanctum tab could not be focused.",
            err
          );
        }
      })
      .catch(async function (err) {
        console.error(
          "Automatic CBS capture failed:",
          err
        );

        await showSanctumError(
          current.sanctumTabId,
          err.message
        );
      });
  }
);

chrome.tabs.onRemoved.addListener(
  function (tabId) {
    if (
      pendingConnect &&
      (
        tabId === pendingConnect.cbsTabId ||
        tabId === pendingConnect.sanctumTabId
      )
    ) {
      clearPendingConnect();
    }
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
