/*
  THE INNER SANCTUM — provider-adapters.js
  --------------------------------------------
  Normalizes Sleeper / Yahoo / ESPN / CBS data into one shared shape
  so pages never touch raw provider JSON directly.

  <script src="provider-adapters.js"></script>
  (include after league-connection.js)
*/

(function () {
  function firstDefined() {
    for (let i = 0; i < arguments.length; i++) {
      const value = arguments[i];
      if (value !== undefined && value !== null) return value;
    }
    return undefined;
  }

  function numberOrDefault(value, fallback) {
    if (value === undefined || value === null || value === "") return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function numberOrNull(value) {
    return numberOrDefault(value, null);
  }

  function normalizeAvailablePlayers(players) {
    if (!Array.isArray(players)) return [];
    return players.map(function (p) {
      return {
        providerPlayerId: firstDefined(p?.providerPlayerId, p?.playerId, p?.id) ?? null,
        name: firstDefined(p?.name, p?.fullName, p?.playerName) ?? "",
        position: firstDefined(p?.position, p?.defaultPosition, p?.pos) ?? "",
        team: firstDefined(p?.team, p?.nflTeam) ?? "",
        availabilityStatus: firstDefined(p?.availabilityStatus, p?.status) ?? null,
        percentOwned: numberOrNull(firstDefined(p?.percentOwned, p?.ownership?.percentOwned)),
        percentStarted: numberOrNull(firstDefined(p?.percentStarted, p?.ownership?.percentStarted)),
        projectedPoints: numberOrNull(firstDefined(p?.projectedPoints, p?.projected, p?.projection)),
      };
    }).filter(function (p) { return Boolean(p.name); });
  }

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
      availablePlayers: normalizeAvailablePlayers(rawData?.availablePlayers),
      matchup: rawData?.matchup ? {
        opponentName: rawData.matchup.opponentName ?? "",
        myProjected: numberOrDefault(rawData.matchup.myProjected, 0),
        opponentProjected: numberOrDefault(rawData.matchup.opponentProjected, 0),
        winProbability: rawData.matchup.winProbability ?? null,
      } : null,
    };
  }

  function normalizeYahooData(rawData) {
    return {
      leagueName: rawData?.league?.name ?? "",
      teamName: rawData?.team?.name ?? "",
      record: {
        wins: rawData?.team?.team_standings?.outcome_totals?.wins ?? 0,
        losses: rawData?.team?.team_standings?.outcome_totals?.losses ?? 0,
        ties: rawData?.team?.team_standings?.outcome_totals?.ties ?? 0,
      },
      standing: rawData?.team?.team_standings?.rank ?? null,
      roster: [],
      availablePlayers: normalizeAvailablePlayers(rawData?.availablePlayers),
      matchup: null,
    };
  }

  function normalizeEspnData(rawData) {
    const leagueData = rawData?.league && typeof rawData.league === "object" ? rawData.league : rawData;
    const availablePlayers = firstDefined(rawData?.availablePlayers, leagueData?.availablePlayers);
    return {
      leagueName: firstDefined(rawData?.leagueName, leagueData?.name, leagueData?.settings?.name) ?? "",
      teamName: firstDefined(
        rawData?.team?.name,
        rawData?.team?.location && rawData?.team?.nickname
          ? `${rawData.team.location} ${rawData.team.nickname}`
          : undefined
      ) ?? "",
      record: {
        wins: rawData?.team?.record?.overall?.wins ?? 0,
        losses: rawData?.team?.record?.overall?.losses ?? 0,
        ties: rawData?.team?.record?.overall?.ties ?? 0,
      },
      standing: firstDefined(rawData?.team?.rank, rawData?.team?.playoffSeed) ?? null,
      roster: Array.isArray(rawData?.roster) ? rawData.roster.map(function (p) {
        return {
          name: firstDefined(p?.name, p?.fullName) ?? "",
          position: firstDefined(p?.position, p?.defaultPosition) ?? "",
          team: firstDefined(p?.nflTeam, p?.team) ?? "",
          projectedPoints: numberOrDefault(firstDefined(p?.projectedPoints, p?.projected), 0),
        };
      }) : [],
      availablePlayers: normalizeAvailablePlayers(availablePlayers),
      availabilityMeta: firstDefined(rawData?.availabilityMeta, leagueData?.availabilityMeta) ?? null,
      matchup: rawData?.matchup ? {
        opponentName: rawData.matchup.opponentName ?? "",
        myProjected: numberOrDefault(rawData.matchup.myProjected, 0),
        opponentProjected: numberOrDefault(rawData.matchup.opponentProjected, 0),
        winProbability: rawData.matchup.winProbability ?? null,
      } : null,
    };
  }

  function normalizeCbsData(rawData) {
    const league = rawData?.league && typeof rawData.league === "object" ? rawData.league : {};
    const team = rawData?.team && typeof rawData.team === "object" ? rawData.team : {};
    const roster = Array.isArray(rawData?.roster) ? rawData.roster : [];
    const matchup = rawData?.matchup && typeof rawData.matchup === "object" ? rawData.matchup : null;
    return {
      leagueName: firstDefined(league.name, rawData?.leagueName) ?? "",
      teamName: firstDefined(team.name, rawData?.teamName) ?? "",
      record: {
        wins: numberOrDefault(firstDefined(team.wins, team.record?.wins, team.record?.overall?.wins), 0),
        losses: numberOrDefault(firstDefined(team.losses, team.record?.losses, team.record?.overall?.losses), 0),
        ties: numberOrDefault(firstDefined(team.ties, team.record?.ties, team.record?.overall?.ties), 0),
      },
      standing: firstDefined(team.rank, team.standing) ?? null,
      roster: roster.map(function (p) {
        return {
          name: firstDefined(p?.name, p?.playerName, p?.fullName) ?? "",
          position: firstDefined(p?.position, p?.pos, p?.elig?.currPos) ?? "",
          team: firstDefined(p?.nflTeam, p?.team) ?? "",
          projectedPoints: numberOrDefault(firstDefined(p?.projectedPoints, p?.projected, p?.projection), 0),
        };
      }).filter(function (p) { return Boolean(p.name); }),
      availablePlayers: normalizeAvailablePlayers(rawData?.availablePlayers),
      matchup: matchup ? {
        opponentName: firstDefined(matchup.opponentName, matchup.opponent?.name) ?? "",
        myProjected: numberOrDefault(firstDefined(matchup.myProjected, matchup.teamProjected), 0),
        opponentProjected: numberOrDefault(firstDefined(matchup.opponentProjected, matchup.opponent?.projected), 0),
        winProbability: firstDefined(matchup.winProbability, matchup.winPct) ?? null,
      } : null,
    };
  }

  window.normalizeLeagueData = function (provider, rawData) {
    if (!provider) throw new Error("normalizeLeagueData requires a provider.");
    if (provider === "sleeper") return normalizeSleeperData(rawData);
    if (provider === "yahoo") return normalizeYahooData(rawData);
    if (provider === "espn") return normalizeEspnData(rawData);
    if (provider === "cbs") return normalizeCbsData(rawData);
    throw new Error("No adapter defined for provider: " + provider);
  };

  /*
    Production safety guard for ESPN Connect.

    The browser extension upgrades this same form into the seamless capture
    flow. If the extension is missing, disabled, or has not been granted site
    access, the website must never fall back to asking a customer for ESPN
    cookies/session values. Keep the button/result hooks so the extension can
    take over without a second ESPN UI contract.
  */
  function guardLegacyEspnConnectForm() {
    if (!/\/connect-league(?:\.html)?(?:[?#]|$)/i.test(window.location.pathname + window.location.search)) return;
    const selected = document.querySelector("#platform-espn.selected");
    const container = document.getElementById("providerForms");
    if (!selected || !container) return;

    const form = container.querySelector(".provider-form");
    if (!form || form.dataset.espnSafeFallback === "true") return;

    const hasLegacyCredentialUi = Boolean(
      form.querySelector("#espnLeagueType, #espnPrivateFields, #espnS2, #espnSwid")
    );
    if (!hasLegacyCredentialUi) return;

    form.dataset.espnSafeFallback = "true";
    form.innerHTML =
      '<div class="beta-pill">ESPN Connect · Beta</div>' +
      '<div class="pf-info">' +
        '<strong>Connect ESPN securely.</strong><br>' +
        'Inner Sanctum Connect opens ESPN in a separate tab. Sign into ESPN normally and open the league you want to connect. No League ID, Public/Private selection, Developer Tools, SWID or espn_s2 copy/paste is required.' +
      '</div>' +
      '<button class="connect-btn" type="button">Connect ESPN League</button>' +
      '<div class="connect-note">' +
        'ESPN Connect is read-only. Your ESPN sign-in stays in ESPN; only sanitized fantasy-league data is returned to Inner Sanctum.' +
      '</div>' +
      '<div class="result-box" id="espnResult"></div>';

    const button = form.querySelector(".connect-btn");
    if (button) {
      button.addEventListener("click", function () {
        window.setTimeout(function () {
          const box = document.getElementById("espnResult");
          if (!box || box.classList.contains("loading") || box.classList.contains("success")) return;
          box.className = "result-box error show";
          box.textContent =
            "⚠️ Inner Sanctum Connect is not active in this browser yet. Enable/install the extension and allow access to The Inner Sanctum and ESPN, then refresh this page. Never paste ESPN cookies or session values here.";
        }, 100);
      });
    }
  }

  if (typeof document !== "undefined") {
    const observer = new MutationObserver(guardLegacyEspnConnectForm);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", guardLegacyEspnConnectForm, { once: true });
    } else {
      guardLegacyEspnConnectForm();
    }
  }
})();