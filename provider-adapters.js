/*
  THE INNER SANCTUM — provider-adapters.js
  --------------------------------------------
  Normalizes Sleeper / Yahoo / ESPN / CBS data into one shared shape
  so pages never touch raw provider JSON directly.

  <script src="provider-adapters.js"></script>
  (include after league-connection.js)

  Shared shape now includes:

    availablePlayers: [
      {
        providerPlayerId,
        name,
        position,
        team,
        availabilityStatus,
        percentOwned,
        percentStarted,
        projectedPoints
      }
    ]

  Providers that do not yet expose league-specific availability return
  an empty array. This lets waiver intelligence consume one contract
  without inventing availability for unsupported providers.
*/

(function () {
  function firstDefined() {
    for (let i = 0; i < arguments.length; i++) {
      const value = arguments[i];

      if (
        value !== undefined &&
        value !== null
      ) {
        return value;
      }
    }

    return undefined;
  }

  function numberOrDefault(
    value,
    fallback
  ) {
    if (
      value === undefined ||
      value === null ||
      value === ""
    ) {
      return fallback;
    }

    const n = Number(value);

    return Number.isFinite(n)
      ? n
      : fallback;
  }

  function numberOrNull(value) {
    return numberOrDefault(
      value,
      null
    );
  }

  function normalizeAvailablePlayers(
    players
  ) {
    if (!Array.isArray(players)) {
      return [];
    }

    return players
      .map(
        function (p) {
          return {
            providerPlayerId:
              firstDefined(
                p?.providerPlayerId,
                p?.playerId,
                p?.id
              ) ?? null,

            name:
              firstDefined(
                p?.name,
                p?.fullName,
                p?.playerName
              ) ?? "",

            position:
              firstDefined(
                p?.position,
                p?.defaultPosition,
                p?.pos
              ) ?? "",

            team:
              firstDefined(
                p?.team,
                p?.nflTeam
              ) ?? "",

            availabilityStatus:
              firstDefined(
                p?.availabilityStatus,
                p?.status
              ) ?? null,

            percentOwned:
              numberOrNull(
                firstDefined(
                  p?.percentOwned,
                  p?.ownership?.percentOwned
                )
              ),

            percentStarted:
              numberOrNull(
                firstDefined(
                  p?.percentStarted,
                  p?.ownership?.percentStarted
                )
              ),

            projectedPoints:
              numberOrNull(
                firstDefined(
                  p?.projectedPoints,
                  p?.projected,
                  p?.projection
                )
              ),
          };
        }
      )
      .filter(
        function (p) {
          return Boolean(p.name);
        }
      );
  }

  /*
    SLEEPER
  */

  function normalizeSleeperData(rawData) {
    return {
      leagueName:
        rawData?.league?.name ?? "",

      teamName:
        rawData?.team?.name ?? "",

      record: {
        wins:
          rawData?.team?.wins ?? 0,

        losses:
          rawData?.team?.losses ?? 0,

        ties:
          rawData?.team?.ties ?? 0,
      },

      standing:
        rawData?.team?.rank ?? null,

      roster:
        (rawData?.roster ?? [])
          .map(
            function (p) {
              return {
                name:
                  p.name ?? "",

                position:
                  p.position ?? "",

                team:
                  p.nflTeam ?? "",

                projectedPoints:
                  numberOrDefault(
                    p.projected,
                    0
                  ),
              };
            }
          ),

      availablePlayers:
        normalizeAvailablePlayers(
          rawData?.availablePlayers
        ),

      matchup:
        rawData?.matchup
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
    YAHOO

    Placeholder until official Yahoo API access is fully available.
  */

  function normalizeYahooData(rawData) {
    return {
      leagueName:
        rawData?.league?.name ?? "",

      teamName:
        rawData?.team?.name ?? "",

      record: {
        wins:
          rawData?.team
            ?.team_standings
            ?.outcome_totals
            ?.wins ?? 0,

        losses:
          rawData?.team
            ?.team_standings
            ?.outcome_totals
            ?.losses ?? 0,

        ties:
          rawData?.team
            ?.team_standings
            ?.outcome_totals
            ?.ties ?? 0,
      },

      standing:
        rawData?.team
          ?.team_standings
          ?.rank ?? null,

      roster: [],

      availablePlayers:
        normalizeAvailablePlayers(
          rawData?.availablePlayers
        ),

      matchup:
        null,
    };
  }

  /*
    ESPN

    The ESPN Netlify function keeps ESPN's raw league response intact and
    adds a sanitized league-specific availablePlayers array. The adapter
    consumes only that normalized availability array; it does not depend
    on kona_player_info's raw response shape.
  */

  function normalizeEspnData(rawData) {
    const leagueData =
      rawData?.league &&
      typeof rawData.league ===
        "object"
        ? rawData.league
        : rawData;

    const availablePlayers =
      firstDefined(
        rawData?.availablePlayers,
        leagueData?.availablePlayers
      );

    return {
      leagueName:
        firstDefined(
          rawData?.leagueName,
          leagueData?.name,
          leagueData?.settings?.name
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

      roster:
        Array.isArray(rawData?.roster)
          ? rawData.roster.map(
              function (p) {
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
              }
            )
          : [],

      availablePlayers:
        normalizeAvailablePlayers(
          availablePlayers
        ),

      availabilityMeta:
        firstDefined(
          rawData?.availabilityMeta,
          leagueData?.availabilityMeta
        ) ?? null,

      matchup:
        rawData?.matchup
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
  */

  function normalizeCbsData(rawData) {
    const league =
      rawData?.league &&
      typeof rawData.league ===
        "object"
        ? rawData.league
        : {};

    const team =
      rawData?.team &&
      typeof rawData.team ===
        "object"
        ? rawData.team
        : {};

    const roster =
      Array.isArray(rawData?.roster)
        ? rawData.roster
        : [];

    const matchup =
      rawData?.matchup &&
      typeof rawData.matchup ===
        "object"
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
        wins:
          numberOrDefault(
            firstDefined(
              team.wins,
              team.record?.wins,
              team.record?.overall?.wins
            ),
            0
          ),

        losses:
          numberOrDefault(
            firstDefined(
              team.losses,
              team.record?.losses,
              team.record?.overall?.losses
            ),
            0
          ),

        ties:
          numberOrDefault(
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

      roster:
        roster
          .map(
            function (p) {
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
            }
          )
          .filter(
            function (p) {
              return Boolean(p.name);
            }
          ),

      availablePlayers:
        normalizeAvailablePlayers(
          rawData?.availablePlayers
        ),

      matchup:
        matchup
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

  window.normalizeLeagueData =
    function (
      provider,
      rawData
    ) {
      if (!provider) {
        throw new Error(
          "normalizeLeagueData requires a provider."
        );
      }

      if (provider === "sleeper") {
        return normalizeSleeperData(
          rawData
        );
      }

      if (provider === "yahoo") {
        return normalizeYahooData(
          rawData
        );
      }

      if (provider === "espn") {
        return normalizeEspnData(
          rawData
        );
      }

      if (provider === "cbs") {
        return normalizeCbsData(
          rawData
        );
      }

      throw new Error(
        "No adapter defined for provider: " +
        provider
      );
    };
})();