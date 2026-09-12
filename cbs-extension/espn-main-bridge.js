/*
  THE INNER SANCTUM — ESPN MAIN BRIDGE

  Runs inside fantasy.espn.com in the page MAIN world. It uses the
  customer's already-authenticated ESPN browser session and returns only
  sanitized fantasy-league data to the extension bridge.
*/

(function () {
  "use strict";

  const REQUEST = "INNER_SANCTUM_ESPN_MAIN_CAPTURE_REQUEST";
  const RESPONSE = "INNER_SANCTUM_ESPN_MAIN_CAPTURE_RESPONSE";
  const ESPN_BASE_URL = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons";
  const AVAILABLE_PLAYER_LIMIT = 1000;

  // ESPN player.defaultPositionId values. These are NOT lineup-slot IDs.
  const ESPN_DEFAULT_POSITION_BY_ID = {
    1: "QB",
    2: "RB",
    3: "WR",
    4: "TE",
    5: "K",
    16: "D/ST"
  };

  const NFL_TEAM_BY_ID = {
    0: null, 1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE",
    6: "DAL", 7: "DEN", 8: "DET", 9: "GB", 10: "TEN", 11: "IND",
    12: "KC", 13: "LV", 14: "LAR", 15: "MIA", 16: "MIN", 17: "NE",
    18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI", 22: "ARI", 23: "PIT",
    24: "LAC", 25: "SF", 26: "SEA", 27: "TB", 28: "WSH", 29: "CAR",
    30: "JAX", 33: "BAL", 34: "HOU"
  };

  function safeError(error) {
    return error?.message || String(error) || "ESPN capture failed.";
  }

  function currentUrl() {
    try {
      return new URL(window.location.href);
    } catch (err) {
      return null;
    }
  }

  function getLeagueId() {
    const url = currentUrl();
    return String(url?.searchParams?.get("leagueId") || url?.searchParams?.get("leagueID") || "").trim();
  }

  function getTeamIdFromUrl() {
    const url = currentUrl();
    return String(url?.searchParams?.get("teamId") || url?.searchParams?.get("teamID") || "").trim();
  }

  function getSeason() {
    const url = currentUrl();
    const candidate = Number(
      url?.searchParams?.get("seasonId") ||
      url?.searchParams?.get("season") ||
      new Date().getFullYear()
    );
    return Number.isInteger(candidate) ? candidate : new Date().getFullYear();
  }

  function readCookie(name) {
    const prefix = name + "=";
    const found = String(document.cookie || "")
      .split(";")
      .map(function (part) { return part.trim(); })
      .find(function (part) { return part.indexOf(prefix) === 0; });

    if (!found) {
      return "";
    }

    try {
      return decodeURIComponent(found.slice(prefix.length));
    } catch (err) {
      return found.slice(prefix.length);
    }
  }

  function normalizeOwnerId(value) {
    return String(value || "")
      .trim()
      .replace(/^\{/, "")
      .replace(/\}$/, "")
      .toLowerCase();
  }

  function teamName(team) {
    const explicit = String(team?.name || "").trim();
    if (explicit) return explicit;

    const combined = [team?.location, team?.nickname]
      .map(function (value) { return String(value || "").trim(); })
      .filter(Boolean)
      .join(" ");

    return combined || String(team?.abbrev || "").trim() || "ESPN Team";
  }

  function resolveMyTeam(leagueData) {
    const teams = Array.isArray(leagueData?.teams) ? leagueData.teams : [];
    const urlTeamId = getTeamIdFromUrl();

    if (urlTeamId) {
      const byUrl = teams.find(function (team) {
        return String(team?.id) === urlTeamId;
      });
      if (byUrl) return byUrl;
    }

    const ownerId = normalizeOwnerId(readCookie("SWID"));
    if (!ownerId) return null;

    return teams.find(function (team) {
      const owners = [];
      if (team?.primaryOwner) owners.push(team.primaryOwner);
      if (Array.isArray(team?.owners)) owners.push(...team.owners);
      return owners.some(function (owner) {
        return normalizeOwnerId(owner) === ownerId;
      });
    }) || null;
  }

  function normalizeRoster(team) {
    const entries = Array.isArray(team?.roster?.entries) ? team.roster.entries : [];

    return entries.map(function (entry) {
      const player = entry?.playerPoolEntry?.player || entry?.player || null;
      if (!player) return null;

      const defaultPositionId = Number(player.defaultPositionId);
      const proTeamId = Number(player.proTeamId);

      return {
        providerPlayerId: player.id !== undefined && player.id !== null ? String(player.id) : null,
        name: String(player.fullName || player.name || "").trim(),
        position: ESPN_DEFAULT_POSITION_BY_ID[defaultPositionId] || "",
        nflTeam: NFL_TEAM_BY_ID[proTeamId] || "",
        // Preserve ESPN lineup-slot identity separately from player position.
        lineupSlotId: entry?.lineupSlotId ?? null,
        acquisitionType: entry?.acquisitionType || null,
        injuryStatus: player?.injuryStatus || null
      };
    }).filter(function (player) {
      return Boolean(player?.name);
    });
  }

  function normalizeStandings(leagueData) {
    const teams = Array.isArray(leagueData?.teams) ? leagueData.teams : [];
    return teams.map(function (team) {
      const overall = team?.record?.overall || {};
      return {
        teamId: team?.id !== undefined && team?.id !== null ? String(team.id) : null,
        teamName: teamName(team),
        wins: Number(overall.wins || 0),
        losses: Number(overall.losses || 0),
        ties: Number(overall.ties || 0),
        rank: team?.rank ?? team?.playoffSeed ?? null,
        pointsFor: Number(overall.pointsFor || 0),
        pointsAgainst: Number(overall.pointsAgainst || 0)
      };
    });
  }

  function normalizeSchedule(leagueData) {
    const rows = Array.isArray(leagueData?.schedule) ? leagueData.schedule : [];
    return rows.map(function (matchup) {
      return {
        id: matchup?.id ?? null,
        matchupPeriodId: matchup?.matchupPeriodId ?? null,
        homeTeamId: matchup?.home?.teamId !== undefined && matchup?.home?.teamId !== null ? String(matchup.home.teamId) : null,
        awayTeamId: matchup?.away?.teamId !== undefined && matchup?.away?.teamId !== null ? String(matchup.away.teamId) : null,
        homeScore: matchup?.home?.totalPoints ?? null,
        awayScore: matchup?.away?.totalPoints ?? null
      };
    });
  }

  function normalizeMatchup(leagueData, myTeam) {
    if (!myTeam) return null;

    const currentPeriod = Number(
      leagueData?.status?.currentMatchupPeriod ||
      leagueData?.scoringPeriodId ||
      0
    );
    const rows = Array.isArray(leagueData?.schedule) ? leagueData.schedule : [];
    const myTeamId = String(myTeam.id);

    const matchup = rows.find(function (row) {
      return Number(row?.matchupPeriodId) === currentPeriod &&
        (String(row?.home?.teamId) === myTeamId || String(row?.away?.teamId) === myTeamId);
    });

    if (!matchup) return null;

    const isHome = String(matchup?.home?.teamId) === myTeamId;
    const opponentId = isHome ? matchup?.away?.teamId : matchup?.home?.teamId;
    const opponent = (leagueData?.teams || []).find(function (team) {
      return String(team?.id) === String(opponentId);
    });

    return {
      matchupPeriodId: matchup?.matchupPeriodId ?? null,
      opponentTeamId: opponentId !== undefined && opponentId !== null ? String(opponentId) : null,
      opponentName: opponent ? teamName(opponent) : "",
      myScore: isHome ? matchup?.home?.totalPoints ?? null : matchup?.away?.totalPoints ?? null,
      opponentScore: isHome ? matchup?.away?.totalPoints ?? null : matchup?.home?.totalPoints ?? null
    };
  }

  function numberOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function normalizeAvailabilityStatus(value) {
    const status = String(value || "").trim().toUpperCase();
    if (status === "WAIVERS") return "WAIVERS";
    if (status === "FREEAGENT" || status === "FREE_AGENT") return "FREE_AGENT";
    return status || null;
  }

  function currentScoringPeriod(leagueData) {
    const candidates = [
      leagueData?.scoringPeriodId,
      leagueData?.status?.currentScoringPeriod,
      leagueData?.status?.currentMatchupPeriod,
      leagueData?.status?.latestScoringPeriod
    ];
    for (const candidate of candidates) {
      const value = Number(candidate);
      if (Number.isInteger(value) && value >= 1 && value <= 18) return value;
    }
    return 1;
  }

  function projectedPoints(player, scoringPeriodId) {
    const direct = [player?.projectedPoints, player?.projected, player?.projectedScore];
    for (const value of direct) {
      const n = numberOrNull(value);
      if (n !== null) return n;
    }

    const stats = Array.isArray(player?.stats) ? player.stats : [];
    const projection = stats.find(function (stat) {
      return Number(stat?.scoringPeriodId) === Number(scoringPeriodId) &&
        Number(stat?.statSourceId) === 1 &&
        numberOrNull(stat?.appliedTotal) !== null;
    });
    return projection ? numberOrNull(projection.appliedTotal) : null;
  }

  function normalizeAvailablePlayers(rawData, scoringPeriodId) {
    const rows = Array.isArray(rawData?.players) ? rawData.players : [];
    const normalized = [];
    const seen = new Set();

    rows.forEach(function (entry) {
      const player = entry?.player && typeof entry.player === "object" ? entry.player : entry;
      const playerId = player?.id ?? entry?.id ?? null;
      const name = String(player?.fullName || player?.name || "").trim();
      if (!name) return;

      const key = playerId !== null && playerId !== undefined ? String(playerId) : name.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);

      const defaultPositionId = numberOrNull(player?.defaultPositionId);
      const proTeamId = numberOrNull(player?.proTeamId);
      const rawStatus = entry?.status ?? player?.status ?? null;

      normalized.push({
        providerPlayerId: playerId !== null && playerId !== undefined ? String(playerId) : null,
        name,
        position: defaultPositionId !== null ? ESPN_DEFAULT_POSITION_BY_ID[defaultPositionId] || null : null,
        nflTeam: proTeamId !== null ? NFL_TEAM_BY_ID[proTeamId] || null : null,
        availabilityStatus: normalizeAvailabilityStatus(rawStatus),
        percentOwned: numberOrNull(entry?.percentOwned ?? player?.percentOwned ?? player?.ownership?.percentOwned),
        percentStarted: numberOrNull(entry?.percentStarted ?? player?.percentStarted ?? player?.ownership?.percentStarted),
        projectedPoints: projectedPoints(player, scoringPeriodId),
        scoringPeriodId
      });
    });

    return normalized;
  }

  async function fetchAvailablePlayers(leagueId, season, scoringPeriodId) {
    const url = ESPN_BASE_URL + "/" + encodeURIComponent(season) +
      "/segments/0/leagues/" + encodeURIComponent(leagueId) +
      "?view=kona_player_info&scoringPeriodId=" + encodeURIComponent(scoringPeriodId);

    const fantasyFilter = {
      players: {
        filterStatus: { value: ["FREEAGENT", "WAIVERS"] },
        filterSlotIds: { value: [] },
        limit: AVAILABLE_PLAYER_LIMIT,
        sortPercOwned: { sortPriority: 1, sortAsc: false },
        sortDraftRanks: { sortPriority: 100, sortAsc: true, value: "STANDARD" }
      }
    };

    try {
      const response = await fetch(url, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: {
          "x-fantasy-filter": JSON.stringify(fantasyFilter)
        }
      });

      if (!response.ok) {
        return {
          players: [],
          meta: { complete: false, status: response.status, reason: "espn_availability_http_error" }
        };
      }

      const data = await response.json();
      const players = normalizeAvailablePlayers(data, scoringPeriodId);
      return {
        players,
        meta: { complete: true, count: players.length, scoringPeriodId }
      };
    } catch (err) {
      return {
        players: [],
        meta: { complete: false, reason: "espn_availability_capture_failed", error: safeError(err) }
      };
    }
  }

  async function fetchLeague() {
    const leagueId = getLeagueId();
    if (!leagueId) {
      throw new Error("Open the ESPN fantasy-football league you want to connect.");
    }

    const season = getSeason();
    const views = ["mTeam", "mRoster", "mMatchup", "mSettings"];
    const query = views.map(function (view) {
      return "view=" + encodeURIComponent(view);
    }).join("&");

    const url = ESPN_BASE_URL + "/" + encodeURIComponent(season) +
      "/segments/0/leagues/" + encodeURIComponent(leagueId) + "?" + query;

    const response = await fetch(url, {
      method: "GET",
      credentials: "include",
      cache: "no-store"
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error("ESPN has not authorized this league yet. Make sure you are signed in and open the league again.");
    }
    if (response.status === 404) {
      throw new Error("ESPN could not find this league for the current season.");
    }
    if (!response.ok) {
      throw new Error("ESPN returned status " + response.status + ". Try opening the league again.");
    }

    const leagueData = await response.json();
    const myTeam = resolveMyTeam(leagueData);
    if (!myTeam) {
      throw new Error("Your ESPN league was found, but Inner Sanctum could not identify your team yet. Open your team page inside this league and try again.");
    }

    const roster = normalizeRoster(myTeam);
    if (!roster.length) {
      throw new Error("Your ESPN team was found, but the roster is not ready yet.");
    }

    const scoringPeriodId = currentScoringPeriod(leagueData);
    const availability = await fetchAvailablePlayers(leagueId, season, scoringPeriodId);
    const overall = myTeam?.record?.overall || {};

    return {
      league: {
        id: String(leagueData?.id || leagueId),
        name: String(leagueData?.settings?.name || leagueData?.name || "ESPN League"),
        season: season,
        teamCount: Number(leagueData?.settings?.size || leagueData?.teams?.length || 0) || null,
        availablePlayers: availability.players
      },
      team: {
        id: String(myTeam.id),
        name: teamName(myTeam),
        wins: Number(overall.wins || 0),
        losses: Number(overall.losses || 0),
        ties: Number(overall.ties || 0),
        rank: myTeam?.rank ?? myTeam?.playoffSeed ?? null
      },
      roster: roster,
      availablePlayers: availability.players,
      availabilityMeta: availability.meta,
      standings: normalizeStandings(leagueData),
      schedule: normalizeSchedule(leagueData),
      matchup: normalizeMatchup(leagueData, myTeam),
      settings: {
        name: leagueData?.settings?.name || null,
        size: leagueData?.settings?.size || null,
        rosterSettings: leagueData?.settings?.rosterSettings || null,
        scoringSettings: leagueData?.settings?.scoringSettings || null,
        scheduleSettings: leagueData?.settings?.scheduleSettings || null
      },
      meta: {
        source: "espn-browser-assisted",
        readOnly: true,
        capturedAt: new Date().toISOString(),
        dataQuality: {
          complete: Boolean(leagueId && myTeam?.id && roster.length),
          availablePlayerCount: availability.players.length
        }
      }
    };
  }

  window.addEventListener("message", async function (event) {
    if (event.source !== window) return;
    const message = event.data;
    if (!message || message.type !== REQUEST || !message.requestId) return;

    try {
      const captured = await fetchLeague();
      window.postMessage({
        type: RESPONSE,
        requestId: message.requestId,
        success: true,
        data: captured
      }, "*");
    } catch (err) {
      window.postMessage({
        type: RESPONSE,
        requestId: message.requestId,
        success: false,
        error: safeError(err)
      }, "*");
    }
  });
})();
