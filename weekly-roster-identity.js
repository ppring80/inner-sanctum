/*
  THE INNER SANCTUM — weekly-roster-identity.js
  ---------------------------------------------
  Resolves connected-provider roster names to the canonical names already
  used by Weekly Rankings. This preserves Weekly's existing exact-name
  filtering while removing provider-formatting mismatches.
*/
(function () {
  'use strict';

  var retryTimer = null;
  var retryCount = 0;
  var MAX_RETRIES = 240;   // up to ~60 seconds for the rankings fetch
  var RETRY_MS = 250;

  function isWeeklyPage() {
    return /^\/weekly(?:\.html)?\/?$/i.test(window.location.pathname);
  }

  function clearRetry() {
    if (retryTimer !== null) {
      window.clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function applyWeeklyRosterIdentity() {
    if (!isWeeklyPage()) return false;
    if (typeof window.PlayerIdentity === 'undefined') return false;
    if (typeof window.LeagueConnection === 'undefined') return false;
    if (typeof window.getAllRows !== 'function') return false;
    if (typeof window.state === 'undefined' || !window.state) return false;

    var connection = window.LeagueConnection.getActiveConnection();
    var roster = connection && Array.isArray(connection.roster) ? connection.roster : [];
    var rows = window.getAllRows();
    if (!roster.length || !Array.isArray(rows) || !rows.length) return false;

    var resolvedNames = window.PlayerIdentity.resolveRosterNames(roster, rows);
    if (!resolvedNames.length) return false;

    window.state.myRosterNames = resolvedNames.slice();
    if (Array.isArray(window.state.connectedRosterNames)) {
      window.state.connectedRosterNames = resolvedNames.slice();
    }

    if (typeof window.renderTable === 'function') window.renderTable();
    return true;
  }

  function retryUntilRankingsReady() {
    clearRetry();

    if (applyWeeklyRosterIdentity()) {
      retryCount = 0;
      return;
    }

    if (retryCount >= MAX_RETRIES) {
      retryCount = 0;
      return;
    }

    retryCount += 1;
    retryTimer = window.setTimeout(retryUntilRankingsReady, RETRY_MS);
  }

  function runSoon() {
    retryCount = 0;
    clearRetry();
    retryTimer = window.setTimeout(retryUntilRankingsReady, 0);
  }

  /*
    loadWeeklyRankings() is async and the identity scripts can finish loading
    before ranking rows exist. Wrap future ranking reloads so every week or
    scoring-format change starts a fresh identity pass. The immediate runSoon()
    below also covers the initial load when it began before this script loaded.
  */
  function wrapWeeklyRankingsLoader() {
    if (typeof window.loadWeeklyRankings !== 'function') return;
    if (window.loadWeeklyRankings.__innerSanctumIdentityWrapped) return;

    var original = window.loadWeeklyRankings;
    function wrappedLoadWeeklyRankings() {
      var result = original.apply(this, arguments);
      runSoon();
      return result;
    }
    wrappedLoadWeeklyRankings.__innerSanctumIdentityWrapped = true;
    window.loadWeeklyRankings = wrappedLoadWeeklyRankings;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      wrapWeeklyRankingsLoader();
      runSoon();
    }, { once: true });
  } else {
    wrapWeeklyRankingsLoader();
    runSoon();
  }

  window.addEventListener('innerSanctum:leagueContextChanged', runSoon);

  window.applyWeeklyRosterIdentity = applyWeeklyRosterIdentity;
})();
