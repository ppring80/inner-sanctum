/*
  THE INNER SANCTUM — CBS CONNECT
  Chrome Extension Service Worker

  VERSION 0.1.0

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

const SANCTUM_URL_PATTERN =
  /^https:\/\/(?:www\.)?theinnersanctum\.xyz\/connect-league/i;


/*
  Find an open CBS Fantasy league tab.

  For Phase 1:
  if multiple CBS tabs exist, prefer the active one.
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

  This calls the receiver we already built:

      window.receiveCbsConnection(captured)
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


/*
  Update the consumer connection page with a visible
  error without requiring any manual debugging.
*/

async function showSanctumError(
  sanctumTabId,
  message
) {
  try {
    await chrome.scripting.executeScript({
      target: {
        tabId: sanctumTabId
      },

      world: "MAIN",

      func: function (errorMessage) {
        const box =
          document.getElementById(
            "cbsResult"
          );

        if (!box) {
          return;
        }

        box.className =
          "result-box error show";

        box.textContent =
          "⚠️ " +
          errorMessage;
      },

      args: [
        String(
          message ||
          "CBS connection failed."
        )
      ]
    });
  } catch (err) {
    console.error(
      "Could not display CBS connection error.",
      err
    );
  }
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
    throw new Error(
      "No open CBS Fantasy league was found. Open your CBS fantasy league and make sure you are signed in, then try again."
    );
  }

  /*
    Tell the CBS isolated bridge to request a capture
    from the MAIN-world CBS connector.
  */

  const response =
    await chrome.tabs.sendMessage(
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

  /*
    Additional quality guard.

    The consumer should not be connected to malformed
    CBS data even if a page layout changes.
  */

  if (
    captured.meta?.dataQuality &&
    captured.meta.dataQuality.complete === false
  ) {
    throw new Error(
      "CBS league data was incomplete. Refresh your CBS league page and try again."
    );
  }

  await deliverToSanctum(
    sanctumTab.id,
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
