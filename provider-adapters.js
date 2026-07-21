/*
  THE INNER SANCTUM — provider-adapters.js
  --------------------------------------------
  Normalizes Sleeper vs Yahoo data into one shared shape so pages
  never touch raw provider JSON directly.

  <script src="provider-adapters.js"></script>
  (include after league-connection.js)

  window.normalizeLeagueData(provider, rawData) -> {
    leagueName, teamName,
    record: { wins, losses, ties },
    standing,
    roster: [{ name, position, team, projectedPoints }],
    matchup: { opponentName, myProjected, opponentProjected, winProbability } | null
  }
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

  window.normalizeLeagueData = function (provider, rawData) {
    if (provider === "sleeper") return normalizeSleeperData(rawData);
    if (provider === "yahoo") return normalizeYahooData(rawData);
    throw new Error("No adapter defined for provider: " + provider);
  };
})();
