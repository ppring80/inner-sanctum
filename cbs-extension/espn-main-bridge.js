/*
  THE INNER SANCTUM — ESPN MAIN BRIDGE

  Runs inside fantasy.espn.com in the page's MAIN world.

  PURPOSE
  ------------------------------------------------
  Capture the currently opened ESPN Fantasy Football league using the
  customer's already-authenticated ESPN browser session. Customers never
  copy or paste espn_s2, SWID, passwords, or developer-tool values.

  SECURITY
  ------------------------------------------------
  Authentication stays inside the ESPN browser context. This bridge does
  not return cookies, passwords, authorization headers, or session tokens.
  Only sanitized fantasy-league information is returned to the extension.
*/

(function () {
  "use strict";

  const REQUEST =
    "INNER_SANCTUM_ESPN_MAIN_CAPTURE_REQUEST";

  const RESPONSE =
    "INNER_SANCTUM_ESPN_MAIN_CAPTURE_RESPONSE";

  const ESPN_BASE_URL =
    "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons";

  const POSITION_BY_ID = {
    0: "QB",
    2: "RB",
    4: "WR",
    6: "TE",
    16: "D/ST",
    17: "K"
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

  function safeError(error) {
    return (
      error?.message ||
      String(error) ||
      "ESPN capture failed."
    );
  }

  function getLeagueId() {
    try {
      const url =
        new URL(window.location.href);

      return (
        url.searchParams.get("leagueId") ||
        url.searchParams.get("leagueID") ||
        ""
      ).trim();
    } catch (err) {
      return "";
    }
  }

  function getTeamIdFromUrl() {
    try {
      const url =
        new URL(window.location.href);

      return (
        url.searchParams.get("teamId") ||
        url.searchParams.get("teamID") ||
        ""
      ).trim();
    } catch (err) {
      return "";
    }
  }

  function getSeason() {
    try {
      const url =
        new URL(window.location.href);

      const candidate =
        Number(
          url.searchParams.get("seasonId") ||
          url.searchParams.get("season") ||
          new Date().getFullYear()
        );

      return Number.isInteger(candidate)
        ? candidate
        : new Date().getFullYear();
    } catch (err) {
      return new Date().getFullYear();
    }
  }

  function readCookie(name) {
    const prefix =
      name + "=";

    const parts =
      String(document.cookie || "")
        .split(";")
        .map(function (part) {
          return part.trim();
        });

    const found =
      parts.find(function (part) {
        return part.indexOf(prefix) === 0;
      });

    return found
      ? decodeURIComponent(
          found.slice(prefix.length)
        )
      : "";
  }

  function normalizeOwnerId(value) {
    return String(value || "")
      .trim()
      .replace(/^\{/, "")
      .replace(/\}$/, "")
      .toLowerCase();
  }

  function teamName(team) {
    const explicit =
      String(team?.name || "").trim();

    if (explicit) {
      return explicit;
    }

    const location =
      String(team?.location || "").trim();

    const nickname =
      String(team?.nickname || "").trim();

    return (
      [location, nickname]
        .filter(Boolean)
        .join(" ") ||
      String(team?.abbrev || "").trim() ||
      "ESPN Team"
    );
  }

  function resolveMyTeam(leagueData) {
    const teams =
      Array.isArray(leagueData?.teams)
        ? leagueData.teams
        : [];

    const urlTeamId =
      getTeamIdFromUrl();

    if (urlTeamId) {
      const byUrl =
        teams.find(function (team) {
          return String(team?.id) === urlTeamId;
        });

      if (byUrl) {
        return byUrl;
      }
    }

    const swid =
      normalizeOwnerId(
        readCookie("SWID")
      );

    if (swid) {
      const byOwner =
        teams.find(function (team) {
          const owners = [];

          if (team?.primaryOwner) {
            owners.push(team.primaryOwner);
          }

          if (Array.isArray(team?.owners)) {
            owners.push(...team.owners);
          }

          return owners.some(
            function (owner) {
              return (
                normalizeOwnerId(owner) ===
                swid
              );
            }
          );
        });

      if (byOwner) {
        return byOwner;
      }
    }

    return null;
  }

  function normalizeRoster(team) {
    const entries =
      Array.isArray(
        team?.roster?.entries
      )
        ? team.roster.entries
        : [];

    return entries
      .map(function (entry) {
        const player =
          entry?.playerPoolEntry?.player ||
          entry?.player ||
          null;

        if (!player) {
          return null;
        }

        const positionId =
          Number(player.defaultPositionId);

        const proTeamId =
          Number(player.proTeamId);

        return {
          providerPlayerId:
            player.id !== undefined &&
            player.id !== null
              ? String(player.id)
              : null,

          name:
            String(
              player.fullName ||
              player.name ||
              ""
            ).trim(),

          position:
            POSITION_BY_ID[positionId] ||
            "",

          nflTeam:
            NFL_TEAM_BY_ID[proTeamId] ||
            "",

          lineupSlotId:
            entry?.lineupSlotId ?? null,

          acquisitionType:
            entry?.acquisitionType || null,

          injuryStatus:
            player?.injuryStatus || null
        };
      })
      .filter(function (player) {
        return Boolean(player?.name);
      });
  }

  function normalizeStandings(leagueData) {
    const teams =
      Array.isArray(leagueData?.teams)
        ? leagueData.teams
        : [];

    return teams.map(function (team) {
      const overall =
        team?.record?.overall || {};

      return {
        teamId:
          team?.id !== undefined &&
          team?.id !== null
            ? String(team.id)
            : null,

        teamName:
          teamName(team),

        wins:
          Number(overall.wins || 0),

        losses:
          Number(overall.losses || 0),

        ties:
          Number(overall.ties || 0),

        rank:
          team?.rank ??
          team?.playoffSeed ??
          null,

        pointsFor:
          Number(overall.pointsFor || 0),

        pointsAgainst:
          Number(overall.pointsAgainst || 0)
      };
    });
  }

  function normalizeSchedule(leagueData) {
    const rows =
      Array.isArray(leagueData?.schedule)
        ? leagueData.schedule
        : [];

    return rows.map(function (matchup) {
      return {
        id:
          matchup?.id ?? null,

        matchupPeriodId:
          matchup?.matchupPeriodId ?? null,

        homeTeamId:
          matchup?.home?.teamId !== undefined &&
          matchup?.home?.teamId !== null
            ? String(matchup.home.teamId)
            : null,

        awayTeamId:
          matchup?.away?.teamId !== undefined &&
          matchup?.away?.teamId !== null
            ? String(matchup.away.teamId)
            : null,

        homeScore:
          matchup?.home?.totalPoints ?? null,

        awayScore:
          matchup?.away?.totalPoints ?? null
      };
    });
  }

  function normalizeMatchup(
    leagueData,
    myTeam
  ) {
    if (!myTeam) {
      return null;
    }

    const currentPeriod =
      Number(
        leagueData?.status?.currentMatchupPeriod ||
        leagueData?.scoringPeriodId ||
        0
      );

    const rows =
      Array.isArray(leagueData?.schedule)
        ? leagueData.schedule
        : [];

    const myTeamId =
      String(myTeam.id);

    const matchup =
      rows.find(function (row) {
        return (
          Number(row?.matchupPeriodId) ===
            currentPeriod &&
          (
            String(row?.home?.teamId) ===
              myTeamId ||
            String(row?.away?.teamId) ===
              myTeamId
          )
        );
      });

    if (!matchup) {
      return null;
    }

    const isHome =
      String(matchup?.home?.teamId) ===
      myTeamId;

    const opponentId =
      isHome
        ? matchup?.away?.teamId
        : matchup?.home?.teamId;

    const opponent =
      (leagueData?.teams || [])
        .find(function (team) {
          return (
            String(team?.id) ===
            String(opponentId)
          );
        });

    return {
      matchupPeriodId:
        matchup?.matchupPeriodId ?? null,

      opponentTeamId:
        opponentId !== undefined &&
        opponentId !== null
          ? String(opponentId)
          : null,

      opponentName:
        opponent
          ? teamName(opponent)
          : "",

      myScore:
        isHome
          ? matchup?.home?.totalPoints ?? null
          : matchup?.away?.totalPoints ?? null,

      opponentScore:
        isHome
          ? matchup?.away?.totalPoints ?? null
          : matchup?.home?.totalPoints ?? null
    };
  }

  async function fetchLeague() {
    const leagueId =
      getLeagueId();

    if (!leagueId) {
      throw new Error(
        "Open the ESPN fantasy-football league you want to connect."
      );
    }

    const season =
      getSeason();

    const views = [
      "mTeam",
      "mRoster",
      "mMatchup",
      "mSettings"
    ];

    const query =
      views
        .map(function (view) {
          return (
            "view=" +
            encodeURIComponent(view)
          );
        })
        .join("&");

    const url =
      ESPN_BASE_URL +
      "/" +
      encodeURIComponent(season) +
      "/segments/0/leagues/" +
      encodeURIComponent(leagueId) +
      "?" +
      query;

    const response =
      await fetch(
        url,
        {
          method: "GET",
          credentials: "include",
          cache: "no-store"
        }
      );

    if (
      response.status === 401 ||
      response.status === 403
    ) {
      throw new Error(
        "ESPN has not authorized this league yet. Make sure you are signed in and open the league again."
      );
    }

    if (response.status === 404) {
      throw new Error(
        "ESPN could not find this league for the current season."
      );
    }

    if (!response.ok) {
      throw new Error(
        "ESPN returned status " +
        response.status +
        ". Try opening the league again."
      );
    }

    const leagueData =
      await response.json();

    const myTeam =
      resolveMyTeam(leagueData);

    if (!myTeam) {
      throw new Error(
        "Your ESPN league was found, but Inner Sanctum could not identify your team yet. Open your team page inside this league and try again."
      );
    }

    const roster =
      normalizeRoster(myTeam);

    if (!roster.length) {
      throw new Error(
        "Your ESPN team was found, but the roster is not ready yet."
      );
    }

    const overall =
      myTeam?.record?.overall || {};

    return {
      league: {
        id:
          String(
            leagueData?.id ||
            leagueId
          ),

        name:
          String(
            leagueData?.settings?.name ||
            leagueData?.name ||
            "ESPN League"
          ),

        season:
          season,

        teamCount:
          Number(
            leagueData?.settings?.size ||
            leagueData?.teams?.length ||
            0
          ) || null
      },

      team: {
        id:
          String(myTeam.id),

        name:
          teamName(myTeam),

        wins:
          Number(overall.wins || 0),

        losses:
          Number(overall.losses || 0),

        ties:
          Number(overall.ties || 0),

        rank:
          myTeam?.rank ??
          myTeam?.playoffSeed ??
          null
      },

      roster:
        roster,

      standings:
        normalizeStandings(
          leagueData
        ),

      schedule:
        normalizeSchedule(
          leagueData
        ),

      matchup:
        normalizeMatchup(
          leagueData,
          myTeam
        ),

      settings: {
        name:
          leagueData?.settings?.name ||
          null,

        size:
          leagueData?.settings?.size ||
          null,

        rosterSettings:
          leagueData?.settings?.rosterSettings ||
          null,

        scoringSettings:
          leagueData?.settings?.scoringSettings ||
          null,

        scheduleSettings:
          leagueData?.settings?.scheduleSettings ||
          null
      },

      meta: {
        source:
          "espn-browser-assisted",

        readOnly:
          true,

        capturedAt:
          new Date().toISOString(),

        dataQuality: {
          complete:
            Boolean(
              leagueId &&
              myTeam?.id &&
              roster.length
            )
        }
      }
    };
  }

  window.addEventListener(
    "message",
    async function (event) {
      if (event.source !== window) {
        return;
      }

      const message =
        event.data;

      if (
        !message ||
        message.type !== REQUEST ||
        !message.requestId
      ) {
        return;
      }

      try {
        const captured =
          await fetchLeague();

        window.postMessage(
          {
            type:
              RESPONSE,

            requestId:
              message.requestId,

            success:
              true,

            data:
              captured
          },
          "*"
        );
      } catch (err) {
        window.postMessage(
          {
            type:
              RESPONSE,

            requestId:
              message.requestId,

            success:
              false,

            error:
              safeError(err)
          },
          "*"
        );
      }
    }
  );
})();
