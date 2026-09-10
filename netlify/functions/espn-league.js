// ═══════════════════════════════════════════════════════════════════════
// ESPN-LEAGUE
//
// WHY THIS FILE EXISTS: ESPN has no official public Fantasy API — no
// developer program, no app registration, no OAuth. The known working
// path used by actively-maintained community libraries is ESPN's own
// undocumented v3 endpoint, the same one fantasy.espn.com itself calls.
//
// This function performs two READ-ONLY ESPN requests:
//
//   1. League state:
//      view=mTeam&view=mRoster&view=mMatchup&view=mSettings
//
//   2. League-specific player availability:
//      view=kona_player_info
//      with x-fantasy-filter status FREEAGENT / WAIVERS
//
// AUTH MODEL:
//   - PUBLIC leagues: no authentication is required.
//   - PRIVATE leagues: requests use the visitor's own espn_s2 and SWID
//     values for the current request only.
//
// CREDENTIAL HANDLING:
// espn_s2 and SWID:
//   - arrive only in the current POST request;
//   - are used only for outbound ESPN requests;
//   - are never intentionally logged;
//   - are never stored by this function;
//   - are NOT persisted in LeagueConnection.
//
// AVAILABILITY PHILOSOPHY:
// The availability request is deliberately non-fatal. If ESPN changes the
// undocumented kona_player_info behavior, an otherwise valid league
// connection must continue to work. In that case availablePlayers is []
// and availabilityMeta reports the failure rather than fabricating data.
//
// KNOWN FRAGILITY:
// ESPN's Fantasy endpoint is undocumented and unsupported. ESPN may change
// response shape or access behavior without notice.
// ═══════════════════════════════════════════════════════════════════════

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  : ["https://theinnersanctum.xyz"];

const ESPN_BASE_URL =
  "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons";

const VIEWS = [
  "mTeam",
  "mRoster",
  "mMatchup",
  "mSettings"
];

const AVAILABLE_PLAYER_LIMIT = 1000;

// ESPN uses one ID system for a player's primary/default position
// (player.defaultPositionId) and a completely different ID system for
// lineup slots (used elsewhere for roster/lineup construction). These IDs
// below are defaultPositionId values only and must NOT be replaced with
// ESPN lineup-slot IDs: QB=1, RB=2, WR=3, TE=4, K=5, D/ST=16.
const ESPN_DEFAULT_POSITION_BY_ID = {
  1: "QB",
  2: "RB",
  3: "WR",
  4: "TE",
  5: "K",
  16: "D/ST"
};

const NFL_TEAM_BY_ID = {
  0: null,
  1: "ATL",
  2: "BUF",
  3: "CHI",
  4: "CIN",
  5: "CLE",
  6: "DAL",
  7: "DEN",
  8: "DET",
  9: "GB",
  10: "TEN",
  11: "IND",
  12: "KC",
  13: "LV",
  14: "LAR",
  15: "MIA",
  16: "MIN",
  17: "NE",
  18: "NO",
  19: "NYG",
  20: "NYJ",
  21: "PHI",
  22: "ARI",
  23: "PIT",
  24: "LAC",
  25: "SF",
  26: "SEA",
  27: "TB",
  28: "WSH",
  29: "CAR",
  30: "JAX",
  33: "BAL",
  34: "HOU"
};

function normalizeEspnOwnerId(value) {
  return String(value || "")
    .trim()
    .replace(/^\{/, "")
    .replace(/\}$/, "")
    .toLowerCase();
}

function resolveTeamIdFromSwid(leagueData, swid) {
  const ownerId = normalizeEspnOwnerId(swid);

  if (!ownerId) {
    return null;
  }

  const teams = Array.isArray(leagueData?.teams)
    ? leagueData.teams
    : [];

  const matchedTeam = teams.find(function (team) {
    const owners = [];

    if (team?.primaryOwner) {
      owners.push(team.primaryOwner);
    }

    if (Array.isArray(team?.owners)) {
      owners.push(...team.owners);
    }

    return owners.some(function (owner) {
      return normalizeEspnOwnerId(owner) === ownerId;
    });
  });

  return matchedTeam?.id !== null && matchedTeam?.id !== undefined
    ? String(matchedTeam.id)
    : null;
}

function isOriginAllowed(origin) {
  if (!origin) {
    return true;
  }

  return ALLOWED_ORIGINS.includes(origin);
}

function buildCorsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Headers":
      "Content-Type",

    "Access-Control-Allow-Methods":
      "POST, OPTIONS",

    "Content-Type":
      "application/json",

    "Vary":
      "Origin"
  };

  if (
    origin &&
    ALLOWED_ORIGINS.includes(origin)
  ) {
    headers[
      "Access-Control-Allow-Origin"
    ] = origin;
  }

  return headers;
}

function buildEspnHeaders({
  espn_s2,
  swid,
  fantasyFilter = null
}) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 " +
      "(Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 " +
      "(KHTML, like Gecko) " +
      "Chrome/125.0 Safari/537.36"
  };

  if (espn_s2 && swid) {
    headers.Cookie =
      `espn_s2=${espn_s2}; SWID=${swid}`;
  }

  if (fantasyFilter) {
    headers["x-fantasy-filter"] =
      JSON.stringify(fantasyFilter);
  }

  return headers;
}

function buildLeagueUrl({
  leagueId,
  season,
  params
}) {
  const query =
    new URLSearchParams(params);

  return (
    `${ESPN_BASE_URL}/` +
    `${encodeURIComponent(season)}/` +
    `segments/0/leagues/` +
    `${encodeURIComponent(leagueId)}` +
    `?${query.toString()}`
  );
}

async function fetchEspnJson({
  url,
  espn_s2,
  swid,
  fantasyFilter = null
}) {
  const response =
    await fetch(
      url,
      {
        method:
          "GET",

        headers:
          buildEspnHeaders({
            espn_s2,
            swid,
            fantasyFilter
          })
      }
    );

  if (
    response.status === 401 ||
    response.status === 403
  ) {
    return {
      error:
        "auth",

      status:
        response.status
    };
  }

  if (
    response.status === 404
  ) {
    return {
      error:
        "not_found",

      status:
        response.status
    };
  }

  if (!response.ok) {
    return {
      error:
        "unknown",

      status:
        response.status
    };
  }

  const data =
    await response.json();

  return {
    data:
      data
  };
}

async function fetchEspnLeague({
  leagueId,
  season,
  espn_s2,
  swid
}) {
  const params = {};

  VIEWS.forEach(
    function (view) {
      if (!params.view) {
        params.view = [];
      }

      params.view.push(view);
    }
  );

  const viewParams =
    VIEWS
      .map(
        (view) =>
          `view=${encodeURIComponent(view)}`
      )
      .join("&");

  const url =
    `${ESPN_BASE_URL}/` +
    `${encodeURIComponent(season)}/` +
    `segments/0/leagues/` +
    `${encodeURIComponent(leagueId)}` +
    `?${viewParams}`;

  return fetchEspnJson({
    url,
    espn_s2,
    swid
  });
}

function getCurrentScoringPeriod(leagueData) {
  const candidates = [
    leagueData?.scoringPeriodId,
    leagueData?.status?.currentScoringPeriod,
    leagueData?.status?.currentMatchupPeriod,
    leagueData?.status?.latestScoringPeriod
  ];

  for (const candidate of candidates) {
    const value = Number(candidate);

    if (
      Number.isInteger(value) &&
      value >= 1 &&
      value <= 18
    ) {
      return value;
    }
  }

  return 1;
}

async function fetchEspnAvailablePlayers({
  leagueId,
  season,
  scoringPeriodId,
  espn_s2,
  swid
}) {
  const url =
    buildLeagueUrl({
      leagueId,
      season,
      params: {
        view:
          "kona_player_info",

        scoringPeriodId:
          String(scoringPeriodId)
      }
    });

  const fantasyFilter = {
    players: {
      filterStatus: {
        value: [
          "FREEAGENT",
          "WAIVERS"
        ]
      },

      filterSlotIds: {
        value: []
      },

      limit:
        AVAILABLE_PLAYER_LIMIT,

      sortPercOwned: {
        sortPriority:
          1,

        sortAsc:
          false
      },

      sortDraftRanks: {
        sortPriority:
          100,

        sortAsc:
          true,

        value:
          "STANDARD"
      }
    }
  };

  return fetchEspnJson({
    url,
    espn_s2,
    swid,
    fantasyFilter
  });
}

function numberOrNull(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}

function normalizeAvailabilityStatus(value) {
  const status =
    String(value || "")
      .trim()
      .toUpperCase();

  if (status === "WAIVERS") {
    return "WAIVERS";
  }

  if (
    status === "FREEAGENT" ||
    status === "FREE_AGENT"
  ) {
    return "FREE_AGENT";
  }

  return status || null;
}

function findProjectedPoints(player, scoringPeriodId) {
  const directCandidates = [
    player?.projectedPoints,
    player?.projected,
    player?.projectedScore
  ];

  for (const candidate of directCandidates) {
    const n =
      numberOrNull(candidate);

    if (n !== null) {
      return n;
    }
  }

  const stats =
    Array.isArray(player?.stats)
      ? player.stats
      : [];

  const projection =
    stats.find(
      function (stat) {
        return (
          Number(stat?.scoringPeriodId) ===
            Number(scoringPeriodId) &&
          Number(stat?.statSourceId) === 1 &&
          numberOrNull(stat?.appliedTotal) !== null
        );
      }
    );

  return projection
    ? numberOrNull(
        projection.appliedTotal
      )
    : null;
}

function normalizeEspnAvailablePlayers(
  rawData,
  scoringPeriodId
) {
  const rows =
    Array.isArray(rawData?.players)
      ? rawData.players
      : [];

  const normalized = [];
  const seen = new Set();

  rows.forEach(
    function (entry) {
      const player =
        entry?.player &&
        typeof entry.player ===
          "object"
          ? entry.player
          : entry;

      const playerId =
        player?.id ??
        entry?.id ??
        null;

      const name =
        String(
          player?.fullName ||
          player?.name ||
          ""
        ).trim();

      if (!name) {
        return;
      }

      const key =
        playerId !== null &&
        playerId !== undefined
          ? String(playerId)
          : name.toLowerCase();

      if (seen.has(key)) {
        return;
      }

      seen.add(key);

      const defaultPositionId =
        numberOrNull(
          player?.defaultPositionId
        );

      const proTeamId =
        numberOrNull(
          player?.proTeamId
        );

      const percentOwned =
        numberOrNull(
          entry?.percentOwned ??
          player?.percentOwned ??
          player?.ownership?.percentOwned
        );

      const percentStarted =
        numberOrNull(
          entry?.percentStarted ??
          player?.percentStarted ??
          player?.ownership?.percentStarted
        );

      const rawStatus =
        entry?.status ??
        player?.status ??
        null;

      normalized.push({
        providerPlayerId:
          playerId !== null &&
          playerId !== undefined
            ? String(playerId)
            : null,

        name,

        position:
          defaultPositionId !== null
            ? ESPN_DEFAULT_POSITION_BY_ID[
                defaultPositionId
              ] || null
            : null,

        nflTeam:
          proTeamId !== null
            ? NFL_TEAM_BY_ID[
                proTeamId
              ] || null
            : null,

        availabilityStatus:
          normalizeAvailabilityStatus(
            rawStatus
          ),

        percentOwned,

        percentStarted,

        projectedPoints:
          findProjectedPoints(
            player,
            scoringPeriodId
          ),

        scoringPeriodId:
          scoringPeriodId
      });
    }
  );

  return normalized;
}

exports.handler =
  async function (event) {
    const origin =
      event.headers.origin ||
      event.headers.Origin ||
      "";

    const originAllowed =
      isOriginAllowed(
        origin
      );

    const corsHeaders =
      buildCorsHeaders(
        origin
      );

    if (!originAllowed) {
      console.log(
        `Blocked ESPN league request from unapproved origin: ${origin}`
      );

      return {
        statusCode:
          403,

        headers:
          corsHeaders,

        body:
          JSON.stringify({
            error:
              "Forbidden"
          })
      };
    }

    if (
      event.httpMethod ===
      "OPTIONS"
    ) {
      return {
        statusCode:
          204,

        headers:
          corsHeaders,

        body:
          ""
      };
    }

    if (
      event.httpMethod !==
      "POST"
    ) {
      return {
        statusCode:
          405,

        headers:
          corsHeaders,

        body:
          JSON.stringify({
            error:
              "Method not allowed"
          })
      };
    }

    let payload;

    try {
      payload =
        JSON.parse(
          event.body ||
          "{}"
        );
    } catch (err) {
      return {
        statusCode:
          400,

        headers:
          corsHeaders,

        body:
          JSON.stringify({
            error:
              "Invalid JSON body"
          })
      };
    }

    const {
      leagueId,
      season,
      espn_s2,
      swid
    } = payload;

    if (!leagueId) {
      return {
        statusCode:
          400,

        headers:
          corsHeaders,

        body:
          JSON.stringify({
            error:
              "leagueId is required"
          })
      };
    }

    if (
      Boolean(espn_s2) !==
      Boolean(swid)
    ) {
      return {
        statusCode:
          400,

        headers:
          corsHeaders,

        body:
          JSON.stringify({
            error:
              "Private ESPN leagues require both espn_s2 and SWID."
          })
      };
    }

    const seasonYear =
      season ||
      new Date()
        .getFullYear();

    try {
      const result =
        await fetchEspnLeague({
          leagueId,
          season:
            seasonYear,
          espn_s2,
          swid
        });

      if (
        result.error ===
        "auth"
      ) {
        return {
          statusCode:
            401,

          headers:
            corsHeaders,

          body:
            JSON.stringify({
              error:
                "ESPN rejected this request — for a private league, " +
                "double-check that your espn_s2 and SWID values are current. " +
                "They can expire after you log out of ESPN."
            })
        };
      }

      if (
        result.error ===
        "not_found"
      ) {
        return {
          statusCode:
            404,

          headers:
            corsHeaders,

          body:
            JSON.stringify({
              error:
                "League not found — check your League ID and season year."
            })
        };
      }

      if (result.error) {
        return {
          statusCode:
            502,

          headers:
            corsHeaders,

          body:
            JSON.stringify({
              error:
                "ESPN returned an unexpected response " +
                `(status ${result.status}). ` +
                "Their fantasy endpoint may be unavailable or may have changed."
            })
        };
      }

      const resolvedTeamId =
        resolveTeamIdFromSwid(
          result.data,
          swid
        );

      const scoringPeriodId =
        getCurrentScoringPeriod(
          result.data
        );

      let availablePlayers = [];

      let availabilityMeta = {
        available:
          false,

        source:
          "espn-kona_player_info",

        scoringPeriodId,

        count:
          0,

        warning:
          null
      };

      try {
        const availabilityResult =
          await fetchEspnAvailablePlayers({
            leagueId,
            season:
              seasonYear,
            scoringPeriodId,
            espn_s2,
            swid
          });

        if (availabilityResult.data) {
          availablePlayers =
            normalizeEspnAvailablePlayers(
              availabilityResult.data,
              scoringPeriodId
            );

          availabilityMeta = {
            available:
              true,

            source:
              "espn-kona_player_info",

            scoringPeriodId,

            count:
              availablePlayers.length,

            warning:
              null
          };
        } else {
          availabilityMeta.warning =
            availabilityResult.error ===
              "auth"
              ? "ESPN league connected, but ESPN did not authorize the availability request."
              : "ESPN league connected, but the availability request was unavailable.";
        }
      } catch (availabilityError) {
        availabilityMeta.warning =
          "ESPN league connected, but player availability could not be collected.";
      }

      /*
        Put availability INSIDE the league object as well as at the
        response top level. connect-league.html already persists the
        returned league object, so this makes the new data flow through
        the existing connection path without changing credential handling
        or requiring a second client-side storage implementation.

        resolvedTeamId is a safe, non-secret identity hint derived from the
        request-only SWID. The SWID itself is never persisted or returned.
      */
      const leagueWithAvailability = {
        ...result.data,
        resolvedTeamId,
        availablePlayers,
        availabilityMeta
      };

      return {
        statusCode:
          200,

        headers:
          corsHeaders,

        body:
          JSON.stringify({
            success:
              true,

            league:
              leagueWithAvailability,

            availablePlayers,

            availabilityMeta
          })
      };
    } catch (err) {
      console.log(
        "espn-league handler error:",
        err &&
        err.message
          ? err.message
          : "unknown error"
      );

      return {
        statusCode:
          502,

        headers:
          corsHeaders,

        body:
          JSON.stringify({
            error:
              "Could not reach ESPN. Try again shortly."
          })
      };
    }
  };

exports._test = {
  normalizeEspnAvailablePlayers,
  ESPN_DEFAULT_POSITION_BY_ID
};