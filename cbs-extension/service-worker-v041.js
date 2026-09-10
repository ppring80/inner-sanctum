/*
  THE INNER SANCTUM — CONNECT
  ESPN live-test hardening layer

  VERSION 0.4.1

  Loads the proven 0.4.0 service worker, then makes two narrowly scoped
  ESPN fixes discovered in live testing:
  1. Open ESPN's current Fantasy Football welcome page instead of the
     obsolete /football/ route that now returns "Page not found".
  2. If the customer reaches the selected ESPN league in another ESPN tab,
     adopt that tab into the existing pending connection instead of ignoring it.

  CBS behavior is delegated unchanged to service-worker.js.
*/

"use strict";

importScripts("service-worker.js");

const baseOpenProviderAndWait =
  openProviderAndWait;

const baseHandleTrackedNavigation =
  handleTrackedNavigation;

openProviderAndWait = async function (
  provider,
  sanctumTabId
) {
  if (provider !== "espn") {
    return baseOpenProviderAndWait(
      provider,
      sanctumTabId
    );
  }

  const tab =
    await chrome.tabs.create({
      url: "https://fantasy.espn.com/football/welcome",
      active: true
    });

  if (!tab?.id) {
    throw new Error(
      "ESPN could not be opened."
    );
  }

  await setPending(
    "pendingEspnConnect",
    {
      sanctumTabId,
      providerTabId: tab.id,
      startedAt: Date.now()
    }
  );

  await showSanctumStatus(
    sanctumTabId,
    "espn",
    "loading",
    "🔴 ESPN opened. Sign in normally and open the league you want to connect — Inner Sanctum will detect it automatically."
  );

  return {
    success: true,
    pending: true
  };
};

handleTrackedNavigation = async function (
  provider,
  tabId,
  changeInfo,
  tab
) {
  if (provider === "espn") {
    const pending =
      await getPending(
        "pendingEspnConnect"
      );

    if (pending) {
      const currentUrl =
        tab?.url ||
        changeInfo.url ||
        "";

      let hasLeagueId = false;

      if (
        /^https:\/\/fantasy\.espn\.com\/football\//i
          .test(currentUrl)
      ) {
        try {
          hasLeagueId = Boolean(
            new URL(currentUrl)
              .searchParams
              .get("leagueId")
          );
        } catch (err) {
          hasLeagueId = false;
        }
      }

      if (
        hasLeagueId &&
        pending.providerTabId !== tabId
      ) {
        await setPending(
          "pendingEspnConnect",
          {
            ...pending,
            providerTabId: tabId
          }
        );
      }
    }
  }

  return baseHandleTrackedNavigation(
    provider,
    tabId,
    changeInfo,
    tab
  );
};
