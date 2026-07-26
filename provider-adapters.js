/*
  THE INNER SANCTUM — provider-adapters.js
  --------------------------------------------
  Normalizes Sleeper / Yahoo / ESPN / CBS data into one shared shape
  so pages never touch raw provider JSON directly.

  <script src="provider-adapters.js"></script>
  (include after league-connection.js)

  window.normalizeLeagueData(provider, rawData) -> {
    leagueName, teamName,
    record: { wins, losses, ties },
    standing,
    roster: [{ name, position, team, projectedPoints }],
    matchup: { opponentName, myProjected, opponentProjected, winProbability } | null
  }

  UPDATED (added ESPN + CBS): both are PLACEHOLDER adapters, same
  status as the existing Yahoo one — field names are best-guess from
  public/community documentation since neither has a real backend
  wired yet. Function signature stays stable so pages calling
  normalizeLeagueData() never need to change when the real shape
  gets filled in later.
*/

(function () {
  function normalizeSleeperData(rawData) {
    // Mirror whatever field names the existing Sleeper integration
    // uses elsewhere in the app (e.g. shared-player-data.js) —
    // update these to match the real response shape already in use.
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
          name: p.name,
          position: p.position,
          team: p.nflTeam,
          projectedPoints: p.projected ?? 0,
        };
      }),
      matchup: rawData?.matchup
        ? {
            opponentName: rawData.matchup.opponentName,
            myProjected: rawData.matchup.myProjected,
            opponentProjected: rawData.matchup.opponentProjected,
            winProbability: rawData.matchup.winProbability,
          }
        : null,
    };
  }

  function normalizeYahooData(rawData) {
    // PLACEHOLDER — Yahoo Fantasy API returns XML by default,
    // request ?format=json. Field names are best-guess from public
    // docs; confirm against a real response once credentials land
    // and fill this in for real. Function signature stays stable.
    return {
      leagueName: rawData?.league?.name ?? "",
      teamName: rawData?.team?.name ?? "",
      record: {
        wins: rawData?.team?.team_standings?.outcome_totals?.wins ?? 0,
        losses: rawData?.team?.team_standings?.outcome_totals?.losses ?? 0,
        ties: rawData?.team?.team_standings?.outcome_totals?.ties ?? 0,
      },
      standing: rawData?.team?.team_standings?.rank ?? null,
      roster: [], // TODO: map once real shape is confirmed
      matchup: null, // TODO: map once real shape is confirmed
    };
  }

  function normalizeEspnData(rawData) {
    // PLACEHOLDER — shape based on ESPN's undocumented v3 endpoint
    // (fantasy.espn.com/apis/v3/games/ffl/seasons/{season}/segments/0/
    // leagues/{leagueId}?view=mTeam&view=mRoster&view=mMatchup), per
    // community reverse-engineering docs (ffscrapr, espn-api). ESPN
    // has no official schema to confirm against, so field names here
    // are best-guess until a real response is captured and this gets
    // filled in for real. Function signature stays stable.
    return {
      leagueName: rawData?.settings?.name ?? "",
      teamName: rawData?.team?.name ?? "",
      record: {
        wins: rawData?.team?.record?.overall?.wins ?? 0,
        losses: rawData?.team?.record?.overall?.losses ?? 0,
        ties: rawData?.team?.record?.overall?.ties ?? 0,
      },
      standing: rawData?.team?.playoffSeed ?? null,
      roster: [], // TODO: map once real shape is confirmed
      matchup: null, // TODO: map once real shape is confirmed
    };
  }

  function normalizeCbsData(rawData) {
    // PLACEHOLDER — CBS's Fantasy Platform API (developer.cbssports.com)
    // is officially deprecated; this shape is a best guess from that
    // legacy documentation and community token-fetcher projects. No
    // real response has been captured yet — fill this in for real once
    // one is. Function signature stays stable.
    return {
      leagueName: rawData?.league?.name ?? "",
      teamName: rawData?.team?.name ?? "",
      record: {
        wins: rawData?.team?.wins ?? 0,
        losses: rawData?.team?.losses ?? 0,
        ties: rawData?.team?.ties ?? 0,
      },
      standing: rawData?.team?.rank ?? null,
      roster: [], // TODO: map once real shape is confirmed
      matchup: null, // TODO: map once real shape is confirmed
    };
  }

  window.normalizeLeagueData = function (provider, rawData) {
    if (provider === "sleeper") return normalizeSleeperData(rawData);
    if (provider === "yahoo") return normalizeYahooData(rawData);
    if (provider === "espn") return normalizeEspnData(rawData);
    if (provider === "cbs") return normalizeCbsData(rawData);
    throw new Error("No adapter defined for provider: " + provider);
  };
})();
