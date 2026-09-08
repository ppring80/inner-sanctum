/*
  THE INNER SANCTUM — availability-contract.js
  ------------------------------------------------
  Provider-independent normalization for league-specific player availability.

  Design rule:
  A provider marking a player available is not, by itself, enough to make
  waiver/add-drop advice actionable. The league state must also establish
  that in-season ownership/transaction semantics are meaningful.

  This module deliberately does NOT infer CBS/ESPN league state from
  undocumented provider details. Callers must supply an explicit leagueState.
*/
(function (root, factory) {
  const api = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.InnerSanctumAvailability = api;
  }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const LEAGUE_STATES = Object.freeze({
    PRE_DRAFT: "PRE_DRAFT",
    IN_SEASON: "IN_SEASON",
    UNKNOWN: "UNKNOWN"
  });

  const AVAILABILITY_STATUSES = Object.freeze({
    FREE_AGENT: "FREE_AGENT",
    WAIVERS: "WAIVERS"
  });

  function textOrNull(value) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text || null;
  }

  function numberOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function normalizeLeagueState(value) {
    const normalized = String(value || "").trim().toUpperCase();
    if (normalized === LEAGUE_STATES.PRE_DRAFT) return LEAGUE_STATES.PRE_DRAFT;
    if (normalized === LEAGUE_STATES.IN_SEASON) return LEAGUE_STATES.IN_SEASON;
    return LEAGUE_STATES.UNKNOWN;
  }

  function normalizeAvailabilityStatus(value) {
    const normalized = String(value || "").trim().toUpperCase();

    if (normalized === "FREEAGENT" || normalized === "FREE_AGENT") {
      return AVAILABILITY_STATUSES.FREE_AGENT;
    }

    if (normalized === "WAIVERS") {
      return AVAILABILITY_STATUSES.WAIVERS;
    }

    return textOrNull(normalized);
  }

  function isActionableLeagueState(leagueState) {
    return normalizeLeagueState(leagueState) === LEAGUE_STATES.IN_SEASON;
  }

  function buildActionability(input) {
    const leagueState = normalizeLeagueState(input && input.leagueState);
    const providerAvailable = Boolean(input && input.providerAvailable);

    if (!providerAvailable) {
      return {
        actionable: false,
        reason: "PROVIDER_AVAILABILITY_UNCONFIRMED",
        leagueState
      };
    }

    if (leagueState === LEAGUE_STATES.PRE_DRAFT) {
      return {
        actionable: false,
        reason: "LEAGUE_NOT_DRAFTED",
        leagueState
      };
    }

    if (leagueState !== LEAGUE_STATES.IN_SEASON) {
      return {
        actionable: false,
        reason: "LEAGUE_STATE_UNCONFIRMED",
        leagueState
      };
    }

    return {
      actionable: true,
      reason: null,
      leagueState
    };
  }

  function normalizeAvailablePlayer(player, context) {
    const source = player && typeof player === "object" ? player : {};
    const ctx = context && typeof context === "object" ? context : {};
    const actionability = buildActionability({
      leagueState: ctx.leagueState,
      providerAvailable: ctx.providerAvailable
    });

    return {
      provider: textOrNull(ctx.provider),
      providerPlayerId: textOrNull(source.providerPlayerId),
      name: textOrNull(source.name),
      displayName: textOrNull(source.displayName) || textOrNull(source.name),
      position: textOrNull(source.position),
      nflTeam: textOrNull(source.nflTeam || source.team),
      availabilityStatus: normalizeAvailabilityStatus(source.availabilityStatus || source.status),
      percentOwned: numberOrNull(source.percentOwned),
      percentStarted: numberOrNull(source.percentStarted),
      projectedPoints: numberOrNull(source.projectedPoints),
      scoringPeriodId: numberOrNull(source.scoringPeriodId),
      actionable: actionability.actionable,
      actionabilityReason: actionability.reason
    };
  }

  function buildAvailabilityContext(input) {
    const source = input && typeof input === "object" ? input : {};
    const leagueState = normalizeLeagueState(source.leagueState);
    const providerAvailable = Boolean(source.providerAvailable);
    const actionability = buildActionability({ leagueState, providerAvailable });
    const rawPlayers = Array.isArray(source.availablePlayers) ? source.availablePlayers : [];

    return {
      provider: textOrNull(source.provider),
      leagueState,
      providerAvailable,
      source: textOrNull(source.source),
      warning: textOrNull(source.warning),
      actionable: actionability.actionable,
      actionabilityReason: actionability.reason,
      availablePlayers: rawPlayers
        .map(function (player) {
          return normalizeAvailablePlayer(player, {
            provider: source.provider,
            leagueState,
            providerAvailable
          });
        })
        .filter(function (player) {
          return Boolean(player.name);
        })
    };
  }

  return {
    LEAGUE_STATES,
    AVAILABILITY_STATUSES,
    normalizeLeagueState,
    normalizeAvailabilityStatus,
    isActionableLeagueState,
    buildActionability,
    normalizeAvailablePlayer,
    buildAvailabilityContext
  };
});
