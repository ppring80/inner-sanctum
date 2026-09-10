/*
  THE INNER SANCTUM — weekly-roster-identity.js
  ---------------------------------------------
  Resolves connected-provider roster names to the canonical names already
  used by Weekly Rankings. This preserves Weekly's existing exact-name
  filtering while removing provider-formatting mismatches.
*/
(function () {
  'use strict';

  function isWeeklyPage() {
    return /^\/weekly(?:\.html)?\/?$/i.test(window.location.pathname);
  }

  function applyWeeklyRosterIdentity() {
    if (!isWeeklyPage()) return;
    if (typeof window.PlayerIdentity === 'undefined') return;
    if (typeof window.LeagueConnection === 'undefined') return;
    if (typeof window.getAllRows !== 'function') return;
    if (typeof window.state === 'undefined' || !window.state) return;

    var connection = window.LeagueConnection.getActiveConnection();
    var roster = connection && Array.isArray(connection.roster) ? connection.roster : [];
    var rows = window.getAllRows();
    if (!roster.length || !Array.isArray(rows) || !rows.length) return;

    var resolvedNames = window.PlayerIdentity.resolveRosterNames(roster, rows);
    if (!resolvedNames.length) return;

    window.state.myRosterNames = resolvedNames.slice();
    if (Array.isArray(window.state.connectedRosterNames)) {
      window.state.connectedRosterNames = resolvedNames.slice();
    }

    if (typeof window.renderTable === 'function') window.renderTable();
  }

  function runSoon() {
    window.setTimeout(applyWeeklyRosterIdentity, 0);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runSoon, { once: true });
  } else {
    runSoon();
  }

  window.addEventListener('innerSanctum:leagueContextChanged', runSoon);
  window.addEventListener('innerSanctum:teamContextReady', runSoon);

  window.applyWeeklyRosterIdentity = applyWeeklyRosterIdentity;
})();
