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

  const DEFENSE_TEAM_ALIASES = {
    ARI: "ARI", ARZ: "ARI", ARIZONA: "ARI", ARIZONACARDINALS: "ARI",
    ATL: "ATL", ATLANTA: "ATL", ATLANTAFALCONS: "ATL",
    BAL: "BAL", BLT: "BAL", BALTIMORE: "BAL", BALTIMORERAVENS: "BAL",
    BUF: "BUF", BUFFALO: "BUF", BUFFALOBILLS: "BUF",
    CAR: "CAR", CAROLINA: "CAR", CAROLINAPANTHERS: "CAR",
    CHI: "CHI", CHICAGO: "CHI", CHICAGOBEARS: "CHI",
    CIN: "CIN", CINCINNATI: "CIN", CINCINNATIBENGALS: "CIN",
    CLE: "CLE", CLEVELAND: "CLE", CLEVELANDBROWNS: "CLE",
    DAL: "DAL", DALLAS: "DAL", DALLASCOWBOYS: "DAL",
    DEN: "DEN", DENVER: "DEN", DENVERBRONCOS: "DEN",
    DET: "DET", DETROIT: "DET", DETROITLIONS: "DET",
    GB: "GB", GBP: "GB", GREENBAY: "GB", GREENBAYPACKERS: "GB",
    HOU: "HOU", HST: "HOU", HOUSTON: "HOU", HOUSTONTEXANS: "HOU",
    IND: "IND", INDIANAPOLIS: "IND", INDIANAPOLISCOLTS: "IND",
    JAX: "JAX", JAC: "JAX", JACKSONVILLE: "JAX", JACKSONVILLEJAGUARS: "JAX",
    KC: "KC", KCC: "KC", KANSASCITY: "KC", KANSASCITYCHIEFS: "KC",
    LV: "LV", LVR: "LV", OAK: "LV", LASVEGAS: "LV", LASVEGASRAIDERS: "LV",
    LAC: "LAC", SD: "LAC", SDC: "LAC", LOSANGELESCHARGERS: "LAC", LACHARGERS: "LAC",
    LAR: "LAR", STL: "LAR", LOSANGELESRAMS: "LAR", LARAMS: "LAR",
    MIA: "MIA", MIAMI: "MIA", MIAMIDOLPHINS: "MIA",
    MIN: "MIN", MINNESOTA: "MIN", MINNESOTAVIKINGS: "MIN",
    NE: "NE", NEP: "NE", NEWENGLAND: "NE", NEWENGLANDPATRIOTS: "NE",
    NO: "NO", NOS: "NO", NEWORLEANS: "NO", NEWORLEANSSAINTS: "NO",
    NYG: "NYG", NEWYORKGIANTS: "NYG", NYGIANTS: "NYG",
    NYJ: "NYJ", NEWYORKJETS: "NYJ", NYJETS: "NYJ",
    PHI: "PHI", PHILADELPHIA: "PHI", PHILADELPHIAEAGLES: "PHI",
    PIT: "PIT", PITTSBURGH: "PIT", PITTSBURGHSTEELERS: "PIT",
    SEA: "SEA", SEATTLE: "SEA", SEATTLESEAHAWKS: "SEA",
    SF: "SF", SFO: "SF", SANFRANCISCO: "SF", SANFRANCISCO49ERS: "SF",
    TB: "TB", TBB: "TB", TAMPA: "TB", TAMPABAY: "TB", TAMPABAYBUCCANEERS: "TB",
    TEN: "TEN", TENNESSEE: "TEN", TENNESSEETITANS: "TEN",
    WSH: "WSH", WAS: "WSH", WFT: "WSH", WASHINGTON: "WSH", WASHINGTONCOMMANDERS: "WSH"
  };

  function normalizeDefenseIdentity(
    name,
    position,
    team
  ) {
    const pos = String(position || "")
      .toUpperCase()
      .replace(/[^A-Z]/g, "");

    const isDefense =
      pos === "DEF" ||
      pos === "DST" ||
      pos === "D";

    if (!isDefense) {
      return {
        name: name || "",
        team: team || ""
      };
    }

    const candidates = [
      team,
      name
    ];

    for (let i = 0; i < candidates.length; i++) {
      const key = String(candidates[i] || "")
        .toUpperCase()
        .replace(/D\/?ST/g, "")
        .replace(/DEFENSE/g, "")
        .replace(/[^A-Z0-9]/g, "");

      if (DEFENSE_TEAM_ALIASES[key]) {
        const canonical = DEFENSE_TEAM_ALIASES[key];
        return {
          name: canonical,
          team: canonical
        };
      }
    }

    return {
      name: name || "",
      team: team || ""
    };
  }

  function normalizeRosterPlayer(p) {
    const name = firstDefined(
      p?.name,
      p?.playerName,
      p?.fullName
    ) ?? "";

    const position = firstDefined(
      p?.position,
      p?.defaultPosition,
      p?.pos,
      p?.elig?.currPos
    ) ?? "";

    const team = firstDefined(
      p?.nflTeam,
      p?.team
    ) ?? "";

    const defenseIdentity =
      normalizeDefenseIdentity(
        name,
        position,
        team
      );

    return {
      name: defenseIdentity.name,
      position,
      team: defenseIdentity.team,
      projectedPoints:
        numberOrDefault(
          firstDefined(
            p?.projectedPoints,
            p?.projected,
            p?.projection
          ),
          0
        )
    };
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
          const base = normalizeRosterPlayer(p);

          return {
            providerPlayerId:
              firstDefined(
                p?.providerPlayerId,
                p?.playerId,
                p?.id
              ) ?? null,

            name: base.name,
            position: base.position,
            team: base.team,

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
              base.projectedPoints,
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
          .map(normalizeRosterPlayer),

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
          ? rawData.roster.map(normalizeRosterPlayer)
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
          .map(normalizeRosterPlayer)
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
