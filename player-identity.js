/*
  THE INNER SANCTUM — player-identity.js
  --------------------------------------
  Shared, conservative player-name identity resolution for provider data.

  Goals:
  - normalize punctuation, accents, and common generational suffixes
  - never guess when an abbreviated provider name is ambiguous
  - use position as a safety guard for initial+last-name fallback
*/
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PlayerIdentity = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  var SUFFIXES = {
    jr: true,
    junior: true,
    sr: true,
    senior: true,
    ii: true,
    iii: true,
    iv: true,
    v: true
  };

  function cleanTokens(value) {
    var text = String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[’']/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

    if (!text) return [];
    return text.split(/\s+/).filter(Boolean);
  }

  function stripTerminalSuffix(tokens) {
    var out = tokens.slice();
    while (out.length > 1 && SUFFIXES[out[out.length - 1]]) out.pop();
    return out;
  }

  function canonicalNameKey(value) {
    return stripTerminalSuffix(cleanTokens(value)).join('');
  }

  function normalizedPosition(value) {
    var key = String(value || '').toUpperCase().replace(/[^A-Z]/g, '');
    if (key === 'DST' || key === 'D') return 'DEF';
    return key;
  }

  function nameParts(value) {
    var tokens = stripTerminalSuffix(cleanTokens(value));
    if (!tokens.length) return { first: '', firstInitial: '', last: '', key: '' };
    return {
      first: tokens[0],
      firstInitial: tokens[0].charAt(0),
      last: tokens[tokens.length - 1],
      key: tokens.join('')
    };
  }

  function sameCanonicalName(a, b) {
    var ak = canonicalNameKey(a);
    var bk = canonicalNameKey(b);
    return Boolean(ak && bk && ak === bk);
  }

  function resolveRosterPlayer(rosterPlayer, rankingRows) {
    if (!rosterPlayer || !Array.isArray(rankingRows)) return null;

    var sourceName = rosterPlayer.name || rosterPlayer.displayName || '';
    var sourcePos = normalizedPosition(rosterPlayer.position || rosterPlayer.pos);
    var sourceKey = canonicalNameKey(sourceName);

    if (!sourceKey) return null;

    var exact = rankingRows.filter(function (row) {
      if (!row) return false;
      var rowPos = normalizedPosition(row.pos || row.position);
      if (sourcePos && rowPos && sourcePos !== rowPos) return false;
      return canonicalNameKey(row.name) === sourceKey;
    });

    if (exact.length === 1) return exact[0];
    if (exact.length > 1) return null;

    var sourceParts = nameParts(sourceName);
    if (!sourceParts.firstInitial || !sourceParts.last) return null;

    var abbreviated = sourceParts.first.length === 1 || /^\w\.?\s+/i.test(String(sourceName).trim());
    if (!abbreviated) return null;

    var fallback = rankingRows.filter(function (row) {
      if (!row) return false;
      var rowPos = normalizedPosition(row.pos || row.position);
      if (sourcePos && rowPos && sourcePos !== rowPos) return false;
      var rowParts = nameParts(row.name);
      return rowParts.firstInitial === sourceParts.firstInitial && rowParts.last === sourceParts.last;
    });

    return fallback.length === 1 ? fallback[0] : null;
  }

  function resolveRosterNames(roster, rankingRows) {
    if (!Array.isArray(roster) || !Array.isArray(rankingRows)) return [];

    var resolved = [];
    roster.forEach(function (player) {
      var row = resolveRosterPlayer(player, rankingRows);
      if (row && row.name && resolved.indexOf(row.name) === -1) resolved.push(row.name);
    });
    return resolved;
  }

  return {
    canonicalNameKey: canonicalNameKey,
    normalizedPosition: normalizedPosition,
    nameParts: nameParts,
    sameCanonicalName: sameCanonicalName,
    resolveRosterPlayer: resolveRosterPlayer,
    resolveRosterNames: resolveRosterNames
  };
});
