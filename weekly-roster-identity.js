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

  function lineupNumber(value) {
    var n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  function normalizedCbsPositionLabel(value) {
    return String(value || '')
      .toUpperCase()
      .replace(/D\/?ST/g, 'DEF')
      .replace(/DEFENSE/g, 'DEF')
      .replace(/QUARTERBACKS?/g, 'QB')
      .replace(/RUNNING\s*BACKS?/g, 'RB')
      .replace(/WIDE\s*RECEIVERS?/g, 'WR')
      .replace(/TIGHT\s*ENDS?/g, 'TE')
      .replace(/KICKERS?/g, 'K')
      .replace(/[^A-Z]/g, '');
  }

  /*
    CBS position rows are roster-limit rows, not guaranteed starter counts.
    A zero Active Min means "no minimum roster constraint" and must never
    overwrite Weekly's already-known lineup baseline with zero starters.
    Only a positive Active Min is strong enough evidence to replace a fixed
    starter count. Active Max is intentionally NOT used for fixed positions
    because it can include FLEX-driven roster capacity (for example RB max 4).
  */
  function cbsRequiredStarterCount(entry) {
    if (!entry || typeof entry !== 'object') return null;
    var min = lineupNumber(entry.activeMin);
    return min !== null && min > 0 ? min : null;
  }

  /*
    CBS status rows represent slot capacity. In live captures Active/Reserve
    can legitimately have min=0 while max carries the actual usable slot
    count. Prefer max here, falling back to min only when max is absent.
  */
  function cbsStatusCapacity(statusLimits, pattern) {
    if (!statusLimits || typeof statusLimits !== 'object') return null;
    var keys = Object.keys(statusLimits);
    for (var i = 0; i < keys.length; i++) {
      if (!pattern.test(String(keys[i]))) continue;
      var row = statusLimits[keys[i]] || {};
      var max = lineupNumber(row.max);
      var min = lineupNumber(row.min);
      if (max !== null) return max;
      if (min !== null) return min;
    }
    return null;
  }

  /*
    CBS stores lineup-related roster rules under settings.roster.positions.
    These rows can contain zero Active Min values even when the league has
    normal starters, so CBS-derived construction must be merged onto Weekly's
    existing lineup baseline rather than replacing it with zeroes.

    Positive position minima can safely refine fixed starter counts. The CBS
    Active status capacity gives total starters; after fixed starters are
    accounted for, remaining active slots become FLEX/SUPERFLEX. Composite
    position rows still identify whether the flexible slot includes QB.
  */
  function deriveCbsLineupConstruction(connection, fallbackLineup) {
    if (!connection || String(connection.provider || '').toLowerCase() !== 'cbs') return null;

    var rosterSettings = connection.settings && connection.settings.roster;
    var positions = rosterSettings && rosterSettings.positions;
    if (!positions || typeof positions !== 'object') return null;

    var fallback = fallbackLineup || {};
    var next = {
      QB: lineupNumber(fallback.QB) === null ? 0 : Number(fallback.QB),
      RB: lineupNumber(fallback.RB) === null ? 0 : Number(fallback.RB),
      WR: lineupNumber(fallback.WR) === null ? 0 : Number(fallback.WR),
      TE: lineupNumber(fallback.TE) === null ? 0 : Number(fallback.TE),
      FLEX: 0,
      SUPERFLEX: 0,
      K: lineupNumber(fallback.K) === null ? 0 : Number(fallback.K),
      DEF: lineupNumber(fallback.DEF) === null ? 0 : Number(fallback.DEF),
      BENCH: lineupNumber(fallback.BENCH) === null ? 0 : Number(fallback.BENCH)
    };
    var fixedKeys = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
    var compositeFlex = 0;
    var compositeSuperflex = 0;
    var sawPositionRule = false;

    Object.keys(positions).forEach(function (label) {
      var normalized = normalizedCbsPositionLabel(label);
      var hasQB = normalized.indexOf('QB') !== -1;
      var hasRB = normalized.indexOf('RB') !== -1;
      var hasWR = normalized.indexOf('WR') !== -1;
      var hasTE = normalized.indexOf('TE') !== -1;
      var offensiveCount = (hasQB ? 1 : 0) + (hasRB ? 1 : 0) + (hasWR ? 1 : 0) + (hasTE ? 1 : 0);
      var count = cbsRequiredStarterCount(positions[label]);

      if (offensiveCount >= 2) {
        sawPositionRule = true;
        if (count === null) return;
        if (hasQB) compositeSuperflex = Math.max(compositeSuperflex, count);
        else compositeFlex = Math.max(compositeFlex, count);
        return;
      }

      for (var i = 0; i < fixedKeys.length; i++) {
        if (normalized === fixedKeys[i]) {
          sawPositionRule = true;
          if (count !== null) next[fixedKeys[i]] = count;
          return;
        }
      }
    });

    if (!sawPositionRule) return null;

    next.FLEX = compositeFlex;
    next.SUPERFLEX = compositeSuperflex;

    var statusLimits = rosterSettings.statusLimits || {};
    var activeTotal = cbsStatusCapacity(statusLimits, /^(active|starters?|starting)$/i);
    var fixedTotal = fixedKeys.reduce(function (sum, key) {
      return sum + (lineupNumber(next[key]) || 0);
    }, 0);
    var alreadyFlexible = next.FLEX + next.SUPERFLEX;

    if (activeTotal !== null) {
      var remaining = Math.max(0, activeTotal - fixedTotal - alreadyFlexible);
      if (remaining > 0) {
        if (compositeSuperflex > 0 && compositeFlex === 0) next.SUPERFLEX += remaining;
        else next.FLEX += remaining;
      }
    } else if (alreadyFlexible === 0) {
      next.FLEX = lineupNumber(fallback.FLEX) === null ? 0 : Number(fallback.FLEX);
      next.SUPERFLEX = lineupNumber(fallback.SUPERFLEX) === null ? 0 : Number(fallback.SUPERFLEX);
    }

    var reserveTotal = cbsStatusCapacity(statusLimits, /^(reserve|bench)$/i);
    if (reserveTotal !== null) next.BENCH = reserveTotal;

    return next;
  }

  function getConnectedLineupConstruction(connection, fallbackLineup) {
    if (!connection) return null;
    if (connection.lineupConstruction) return connection.lineupConstruction;
    return deriveCbsLineupConstruction(connection, fallbackLineup);
  }

  function applyConnectedLineupConstruction(connection) {
    if (typeof window.state === 'undefined' || !window.state) return false;

    var current = window.state.lineupConstruction || {};
    var source = getConnectedLineupConstruction(connection, current);
    if (!source) return false;

    var next = {};
    var keys = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPERFLEX', 'K', 'DEF', 'BENCH'];
    var changed = false;

    keys.forEach(function (key) {
      var raw = source[key];
      if (raw === undefined && key === 'SUPERFLEX') raw = source.SFLEX;
      var parsed = lineupNumber(raw);
      next[key] = parsed === null ? (lineupNumber(current[key]) === null ? 0 : Number(current[key])) : parsed;
      if (Number(current[key]) !== next[key]) changed = true;
    });

    if (!changed) return false;

    window.state.lineupConstruction = next;
    if (typeof window.renderLineupFields === 'function') window.renderLineupFields();
    return true;
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

    applyConnectedLineupConstruction(connection);

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

  /*
    Weekly presentation polish is intentionally loaded from this already
    Weekly-only helper instead of competing with league-connection.js loader
    changes. That keeps the proven player-identity/DEF connection path intact.
  */
  function loadWeeklyLineupPolish() {
    if (!isWeeklyPage()) return;
    if (typeof document === 'undefined' || !document.head || typeof document.createElement !== 'function') return;
    if (typeof document.querySelector === 'function' && document.querySelector('script[data-inner-sanctum-weekly-lineup-polish]')) return;

    var script = document.createElement('script');
    script.src = '/weekly-lineup-polish.js';
    script.setAttribute('data-inner-sanctum-weekly-lineup-polish', '1');
    document.head.appendChild(script);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      wrapWeeklyRankingsLoader();
      loadWeeklyLineupPolish();
      runSoon();
    }, { once: true });
  } else {
    wrapWeeklyRankingsLoader();
    loadWeeklyLineupPolish();
    runSoon();
  }

  window.addEventListener('innerSanctum:leagueContextChanged', runSoon);

  window.applyWeeklyRosterIdentity = applyWeeklyRosterIdentity;
  window.applyConnectedLineupConstruction = applyConnectedLineupConstruction;
  window.deriveCbsLineupConstruction = deriveCbsLineupConstruction;
})();