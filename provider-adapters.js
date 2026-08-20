/*
  THE INNER SANCTUM — provider-adapters.js
  --------------------------------------------
  Normalizes Sleeper / Yahoo / ESPN / CBS data into one shared shape
  so pages never touch raw provider JSON directly.

  <script src="provider-adapters.js"></script>
  (include after league-connection.js)

  window.normalizeLeagueData(provider, rawData) -> {
    leagueName,
    teamName,
    record: { wins, losses, ties },
    standing,
    roster: [
      {
        name,
        position,
        team,
        projectedPoints
      }
    ],
    matchup: {
      opponentName,
      myProjected,
      opponentProjected,
      winProbability
    } | null
  }

  PROVIDER RESPONSIBILITIES
  -------------------------

  Sleeper:
    Existing live integration.

  Yahoo:
    Placeholder until official Yahoo API access is fully available.

  ESPN:
    Existing backend integration is beta; adapter remains conservative
    until all live response shapes are fully standardized.

  CBS:
    Browser-assisted READ-ONLY integration.

    IMPORTANT:
    This adapter does NOT log into CBS, handle cookies, solve CAPTCHA,
    inspect the DOM, or store CBS access/session tokens.

    The CBS browser connector is responsible for converting the
    authenticated CBS page/session into a safe intermediate object.

    Expected CBS connector contract:

    {
      league: {
        id: "widebodies",
        name: "WIDE BODIES",
        season: 2026
      },

      team: {
        id: "...",
        name: "The Vanilla Gorilla",
        wins: 0,
        losses: 0,
        ties: 0,
        rank: null
      },

      roster: [
        {
          cbsPlayerId: "2967185",
          name: "Trevor Lawrence",
          position: "QB",
          nflTeam: "JAC",
          status: "A",
          projectedPoints: 0
        }
      ],

      matchup: {
        opponentName: "...",
        myProjected: 0,
        opponentProjected: 0,
        winProbability: null
      } | null
    }

    The connector may omit fields that CBS has not exposed yet.
    This adapter safely defaults missing values rather than forcing
    provider-specific assumptions into consumer pages.
*/

(function () {
  /*
    Small shared helpers keep the provider adapters tolerant of
    missing/null values while preserving zero as a valid value.
  */

  function firstDefined() {
    for (let i = 0; i < arguments.length; i++) {
      const value = arguments[i];

      if (value !== undefined && value !== null) {
        return value;
      }
    }

    return undefined;
  }

  function numberOrDefault(value, fallback) {
    if (value === undefined || value === null || value === "") {
      return fallback;
    }

    const n = Number(value);

    return Number.isFinite(n) ? n : fallback;
  }

  /*
    SLEEPER
  */

  function normalizeSleeperData(rawData) {
    return {
      leagueName: rawData?.league?.name ?? "",

      teamName: rawData?.team?.name ?? "",

      record: {
        wins: rawData?.team?.wins ?? 0,
        losses: rawData?.team?.losses ?? 0,
        ties: rawData?.team?.ties ?? 0,
      },

      standing: rawData?.team?.rank ?? null,

      roster: (rawData?.roster ?? []).map(function (p) {
        return {
          name: p.name ?? "",
          position: p.position ?? "",
          team: p.nflTeam ?? "",
          projectedPoints: numberOrDefault(p.projected, 0),
        };
      }),

      matchup: rawData?.matchup
        ? {
            opponentName: rawData.matchup.opponentName ?? "",
            myProjected: numberOrDefault(
              rawData.matchup.myProjected,
              0
            ),
            opponentProjected: numberOrDefault(
              rawData.matchup.opponentProjected,
              0
            ),
            winProbability:
              rawData.matchup.winProbability ?? null,
          }
        : null,
    };
  }

  /*
    YAHOO

    PLACEHOLDER:
    Yahoo Fantasy API returns XML by default; request JSON where
    supported. Final field mapping should be confirmed against live
    authenticated Yahoo responses once official access is fully active.
  */

  function normalizeYahooData(rawData) {
    return {
      leagueName: rawData?.league?.name ?? "",

      teamName: rawData?.team?.name ?? "",

      record: {
        wins:
          rawData?.team?.team_standings?.outcome_totals?.wins ?? 0,

        losses:
          rawData?.team?.team_standings?.outcome_totals?.losses ?? 0,

        ties:
          rawData?.team?.team_standings?.outcome_totals?.ties ?? 0,
      },

      standing:
        rawData?.team?.team_standings?.rank ?? null,

      roster: [],

      matchup: null,
    };
  }

  /*
    ESPN

    Beta adapter.

    Keep this intentionally conservative until the existing ESPN
    backend response is standardized across a broader sample of
    real leagues.
  */

  function normalizeEspnData(rawData) {
    return {
      leagueName:
        firstDefined(
          rawData?.league?.name,
          rawData?.settings?.name
        ) ?? "",

      teamName:
        firstDefined(
          rawData?.team?.name,
          rawData?.team?.location &&
            rawData?.team?.nickname
            ? `${rawData.team.location} ${rawData.team.nickname}`
            : undefined
        ) ?? "",

      record: {
        wins:
          rawData?.team?.record?.overall?.wins ?? 0,

        losses:
          rawData?.team?.record?.overall?.losses ?? 0,

        ties:
          rawData?.team?.record?.overall?.ties ?? 0,
      },

      standing:
        firstDefined(
          rawData?.team?.rank,
          rawData?.team?.playoffSeed
        ) ?? null,

      roster: Array.isArray(rawData?.roster)
        ? rawData.roster.map(function (p) {
            return {
              name:
                firstDefined(
                  p?.name,
                  p?.fullName
                ) ?? "",

              position:
                firstDefined(
                  p?.position,
                  p?.defaultPosition
                ) ?? "",

              team:
                firstDefined(
                  p?.nflTeam,
                  p?.team
                ) ?? "",

              projectedPoints:
                numberOrDefault(
                  firstDefined(
                    p?.projectedPoints,
                    p?.projected
                  ),
                  0
                ),
            };
          })
        : [],

      matchup: rawData?.matchup
        ? {
            opponentName:
              rawData.matchup.opponentName ?? "",

            myProjected:
              numberOrDefault(
                rawData.matchup.myProjected,
                0
              ),

            opponentProjected:
              numberOrDefault(
                rawData.matchup.opponentProjected,
                0
              ),

            winProbability:
              rawData.matchup.winProbability ?? null,
          }
        : null,
    };
  }

  /*
    CBS

    Browser-assisted READ-ONLY adapter.

    This replaces the retired "CBS is blocked" placeholder.

    We have now confirmed that authenticated CBS fantasy league pages
    expose league-specific information to the user's browser, including:

      - league identity
      - team identity
      - structured roster state
      - CBS player IDs
      - player eligibility / position
      - NFL team
      - roster status
      - CBS fantasy API plumbing

    The future CBS browser connector should extract that information
    into the safe intermediate contract documented at the top of this
    file.

    IMPORTANT SECURITY BOUNDARY:

      rawData passed here must NOT contain:
        - CBS password
        - CBS cookies
        - CBS session identifiers
        - CBS access tokens
        - authorization headers

    Those authentication details belong only in the secure connection
    transport layer and must never reach consumer-facing page state.
  */

  function normalizeCbsData(rawData) {
    const league =
      rawData?.league && typeof rawData.league === "object"
        ? rawData.league
        : {};

    const team =
      rawData?.team && typeof rawData.team === "object"
        ? rawData.team
        : {};

    const roster = Array.isArray(rawData?.roster)
      ? rawData.roster
      : [];

    const matchup =
      rawData?.matchup &&
      typeof rawData.matchup === "object"
        ? rawData.matchup
        : null;

    return {
      leagueName:
        firstDefined(
          league.name,
          rawData?.leagueName
        ) ?? "",

      teamName:
        firstDefined(
          team.name,
          rawData?.teamName
        ) ?? "",

      record: {
        wins: numberOrDefault(
          firstDefined(
            team.wins,
            team.record?.wins,
            team.record?.overall?.wins
          ),
          0
        ),

        losses: numberOrDefault(
          firstDefined(
            team.losses,
            team.record?.losses,
            team.record?.overall?.losses
          ),
          0
        ),

        ties: numberOrDefault(
          firstDefined(
            team.ties,
            team.record?.ties,
            team.record?.overall?.ties
          ),
          0
        ),
      },

      standing:
        firstDefined(
          team.rank,
          team.standing
        ) ?? null,

      roster: roster
        .map(function (p) {
          return {
            name:
              firstDefined(
                p?.name,
                p?.playerName,
                p?.fullName
              ) ?? "",

            position:
              firstDefined(
                p?.position,
                p?.pos,
                p?.elig?.currPos
              ) ?? "",

            team:
              firstDefined(
                p?.nflTeam,
                p?.team
              ) ?? "",

            projectedPoints:
              numberOrDefault(
                firstDefined(
                  p?.projectedPoints,
                  p?.projected,
                  p?.projection
                ),
                0
              ),
          };
        })
        .filter(function (p) {
          /*
            Do not allow placeholder/empty CBS roster slots to leak
            into the normalized roster consumed by Sanctum pages.
          */
          return Boolean(p.name);
        }),

      matchup: matchup
        ? {
            opponentName:
              firstDefined(
                matchup.opponentName,
                matchup.opponent?.name
              ) ?? "",

            myProjected:
              numberOrDefault(
                firstDefined(
                  matchup.myProjected,
                  matchup.teamProjected
                ),
                0
              ),

            opponentProjected:
              numberOrDefault(
                firstDefined(
                  matchup.opponentProjected,
                  matchup.opponent?.projected
                ),
                0
              ),

            winProbability:
              firstDefined(
                matchup.winProbability,
                matchup.winPct
              ) ?? null,
          }
        : null,
    };
  }

  /*
    PUBLIC ENTRY POINT
  */

  window.normalizeLeagueData = function (
    provider,
    rawData
  ) {
    if (!provider) {
      throw new Error(
        "normalizeLeagueData requires a provider."
      );
    }

    if (provider === "sleeper") {
      return normalizeSleeperData(rawData);
    }

    if (provider === "yahoo") {
      return normalizeYahooData(rawData);
    }

    if (provider === "espn") {
      return normalizeEspnData(rawData);
    }

    if (provider === "cbs") {
      return normalizeCbsData(rawData);
    }

    throw new Error(
      "No adapter defined for provider: " + provider
    );
  };
})();
