/*
  THE INNER SANCTUM — fix-my-team-core.js
  ------------------------------------------------
  Provider-independent foundation for Fix My Team.

  This module does not recommend transactions on its own. It assembles a
  trustworthy team-analysis context and gates any future waiver/add-drop
  logic behind the availability contract.
*/
(function (root, factory) {
  let availabilityApi = null;

  if (typeof module !== "undefined" && module.exports) {
    availabilityApi = require("./availability-contract.js");
  } else if (root && root.InnerSanctumAvailability) {
    availabilityApi = root.InnerSanctumAvailability;
  }

  const api = factory(availabilityApi);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.InnerSanctumFixMyTeam = api;
  }
})(typeof window !== "undefined" ? window : null, function (availability) {
  "use strict";

  function textOrNull(value) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text || null;
  }

  function normalizeRosterPlayer(player) {
    const source = player && typeof player === "object" ? player : {};
    return {
      providerPlayerId: textOrNull(source.providerPlayerId || source.playerId || source.id),
      name: textOrNull(source.name || source.displayName),
      displayName: textOrNull(source.displayName || source.name),
      position: textOrNull(source.position),
      nflTeam: textOrNull(source.nflTeam || source.team),
      rosterSlot: textOrNull(source.rosterSlot || source.slot || source.lineupSlot)
    };
  }

  function normalizeRoster(players) {
    if (!Array.isArray(players)) return [];
    return players.map(normalizeRosterPlayer).filter(function (player) {
      return Boolean(player.name);
    });
  }

  function buildPositionCounts(roster) {
    return roster.reduce(function (counts, player) {
      const position = textOrNull(player.position);
      if (!position) return counts;
      counts[position] = (counts[position] || 0) + 1;
      return counts;
    }, {});
  }

  function buildFixMyTeamContext(input) {
    if (!availability || typeof availability.buildAvailabilityContext !== "function") {
      throw new Error("Inner Sanctum availability contract is required");
    }

    const source = input && typeof input === "object" ? input : {};
    const roster = normalizeRoster(source.roster);
    const availabilityContext = availability.buildAvailabilityContext({
      provider: source.provider,
      leagueState: source.leagueState,
      providerAvailable: source.providerAvailable,
      source: source.availabilitySource,
      warning: source.availabilityWarning,
      availablePlayers: source.availablePlayers
    });

    return {
      provider: textOrNull(source.provider),
      leagueId: textOrNull(source.leagueId),
      teamId: textOrNull(source.teamId),
      leagueState: availabilityContext.leagueState,
      roster: roster,
      rosterSize: roster.length,
      positionCounts: buildPositionCounts(roster),
      availability: availabilityContext,
      transactionAdviceAllowed: availabilityContext.actionable,
      transactionAdviceBlockedReason: availabilityContext.actionabilityReason,
      actionableAvailablePlayers: availabilityContext.actionable
        ? availabilityContext.availablePlayers.filter(function (player) {
            return player.actionable;
          })
        : []
    };
  }

  return {
    normalizeRosterPlayer,
    normalizeRoster,
    buildPositionCounts,
    buildFixMyTeamContext
  };
});
