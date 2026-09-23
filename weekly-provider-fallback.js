(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WeeklyProviderFallback = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

  function numberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    var number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function normalizePosition(value) {
    var position = String(value || '').trim().toUpperCase();
    if (position === 'PK') return 'K';
    if (position === 'DST' || position === 'D/ST' || position === 'D') return 'DEF';
    return POSITIONS.indexOf(position) >= 0 ? position : null;
  }

  function normalizeName(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  function playerName(player) {
    return String(
      player && (player.name || player.fullName || player.longName || player.displayName) || ''
    ).trim();
  }

  function playerTeam(player) {
    return String(player && (player.nflTeam || player.team || player.teamAbv) || '').trim().toUpperCase();
  }

  function playerProjection(player) {
    return numberOrNull(
      player && (
        player.projectedPoints !== undefined ? player.projectedPoints :
        player.projection && player.projection.points !== undefined ? player.projection.points :
        player.projected
      )
    );
  }

  function projectionRows(connection) {
    var projectionData = connection && connection.projections || {};
    return []
      .concat(Array.isArray(projectionData.playerProjectionsById) ? projectionData.playerProjectionsById : [])
      .concat(Array.isArray(projectionData.playerProjectionsByName) ? projectionData.playerProjectionsByName : []);
  }

  function candidateRows(connection) {
    var league = connection && connection.league || {};
    return []
      .concat(Array.isArray(connection && connection.availablePlayers) ? connection.availablePlayers : [])
      .concat(Array.isArray(league.availablePlayers) ? league.availablePlayers : [])
      .concat(Array.isArray(connection && connection.roster) ? connection.roster : [])
      .concat(projectionRows(connection));
  }

  function rosterIdentityMap(connection) {
    var identities = {};
    var roster = connection && connection.roster;
    if (!Array.isArray(roster)) return identities;
    roster.forEach(function (player) {
      var name = playerName(player);
      var position = normalizePosition(player && (player.position || player.pos || player.defaultPosition));
      if (name && position) identities[normalizeName(name) + '|' + position] = true;
    });
    return identities;
  }

  function build(connection, options) {
    var settings = options || {};
    var positions = { QB: [], RB: [], WR: [], TE: [], K: [], DEF: [] };
    var byIdentity = {};
    var rosterIdentities = rosterIdentityMap(connection);

    candidateRows(connection).forEach(function (player) {
      if (!player || player.active === false) return;
      var name = playerName(player);
      var position = normalizePosition(player.position || player.pos || player.defaultPosition);
      var projectedPoints = playerProjection(player);
      if (!name || !position) return;

      var team = playerTeam(player);
      var key = normalizeName(name) + '|' + position;
      var isRosterPlayer = rosterIdentities[key] === true;
      if (projectedPoints === null && !isRosterPlayer) return;
      var existing = byIdentity[key];
      var row = {
        playerID: player.providerPlayerId || player.cbsPlayerId || player.id || null,
        name: name,
        team: team || null,
        position: position,
        opponent: player.opponent || player.opponentTeam || player.matchup || null,
        projectedPoints: projectedPoints,
        sageScore: null,
        sageLabel: null,
        sageConfidence: null,
        sageConfidenceLabel: null,
        baselineEvidenceType: 'provider-projection-fallback',
        recommendation: null,
        sageTake: projectedPoints === null
          ? 'Provider projection is unavailable. Weekly SAGE evidence is updating.'
          : 'Provider projection: ' + projectedPoints.toFixed(1) + ' points. Weekly SAGE evidence is updating.'
      };

      if (!existing || (projectedPoints !== null && (existing.projectedPoints === null || projectedPoints > existing.projectedPoints))) {
        byIdentity[key] = row;
      }
    });

    Object.keys(byIdentity).forEach(function (key) {
      var row = byIdentity[key];
      positions[row.position].push(row);
    });

    POSITIONS.forEach(function (position) {
      positions[position] = positions[position]
        .sort(function (a, b) {
          if (a.projectedPoints === null && b.projectedPoints !== null) return 1;
          if (a.projectedPoints !== null && b.projectedPoints === null) return -1;
          if (a.projectedPoints !== null && b.projectedPoints !== null && a.projectedPoints !== b.projectedPoints) {
            return b.projectedPoints - a.projectedPoints;
          }
          return a.name.localeCompare(b.name);
        })
        .map(function (row, index) {
          return Object.assign({}, row, { rank: index + 1, positionRank: index + 1 });
        });
    });

    var playerCount = POSITIONS.reduce(function (total, position) {
      return total + positions[position].length;
    }, 0);

    if (!playerCount) return null;

    return {
      evidenceType: 'weekly-provider-projection-fallback',
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      season: String(settings.season || ''),
      targetWeek: Number(settings.week) || null,
      seasonType: 'reg',
      scoring: settings.scoring || null,
      positions: positions,
      failures: {},
      metadata: {
        degradedMode: true,
        providerProjectionFallbackUsed: true,
        provider: connection && connection.provider || null,
        playerCount: playerCount,
        note: 'Connected-provider projections are shown while Weekly SAGE evidence is unavailable.'
      }
    };
  }

  return {
    build: build,
    normalizePosition: normalizePosition,
    candidateRows: candidateRows
  };
});
