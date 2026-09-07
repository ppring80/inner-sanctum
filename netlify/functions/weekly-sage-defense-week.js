// netlify/functions/weekly-sage-defense-week.js
//
// WEEKLY SAGE — ONE-WEEK DEFENSIVE EVIDENCE BUILDER
//
// This module owns the bounded Tank01 build for one completed NFL week.
// The expensive provider work is intentionally INTERNAL-ONLY: the
// scheduled refresh writer imports buildWeeklyDefense() in-process.
// Direct HTTP requests to this Netlify Function do not trigger Tank01.
//
// Provider cost per build:
//   1 x getNFLGamesForWeek
//   + 1 x getNFLBoxScore per completed game
//
// No SAGE recommendation or player-ranking logic lives here.

const TANK01_HOST =
  "tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com";

const DEFAULT_SEASON_TYPE = "reg";
const BOX_SCORE_CONCURRENCY = 4;

function tank01Headers() {
  return {
    "Content-Type": "application/json",
    "x-rapidapi-host": TANK01_HOST,
    "x-rapidapi-key": process.env.TANK01_API_KEY
  };
}

async function tank01Fetch(endpoint, params) {
  const query = new URLSearchParams(params || {}).toString();
  const url =
    `https://${TANK01_HOST}/${endpoint}` +
    (query ? `?${query}` : "");

  const response = await fetch(url, {
    method: "GET",
    headers: tank01Headers()
  });

  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }

  if (!response.ok) {
    let message =
      `Tank01 ${endpoint} failed with HTTP ${response.status}`;

    if (data && data.message) {
      message = data.message;
    } else if (
      data &&
      data.body &&
      typeof data.body === "string"
    ) {
      message = data.body;
    }

    throw new Error(message);
  }

  return data;
}

function numberValue(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return 0;
  }

  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseCompletionsAttempts(value) {
  if (!value || typeof value !== "string") {
    return { completions: 0, attempts: 0 };
  }

  const parts = value.split("-");
  return {
    completions: numberValue(parts[0]),
    attempts: numberValue(parts[1])
  };
}

function parseSacks(value) {
  if (!value || typeof value !== "string") {
    return { sacks: 0, yardsLost: 0 };
  }

  const parts = value.split("-");
  return {
    sacks: numberValue(parts[0]),
    yardsLost: numberValue(parts[1])
  };
}

function isCompletedGame(game) {
  const status = String(
    game && game.gameStatus ? game.gameStatus : ""
  )
    .trim()
    .toLowerCase();

  return status === "completed" || status === "final";
}

function emptyDefenseProfile(team) {
  return {
    team,
    games: 0,
    runDefense: {
      attemptsAllowed: 0,
      yardsAllowed: 0,
      touchdownsAllowed: 0,
      yardsPerCarryAllowed: 0
    },
    passDefense: {
      attemptsAllowed: 0,
      completionsAllowed: 0,
      yardsAllowed: 0,
      touchdownsAllowed: 0,
      interceptions: 0,
      sacks: 0,
      yardsPerAttemptAllowed: 0,
      completionPctAllowed: 0
    },
    totalDefense: {
      yardsAllowed: 0,
      playsFaced: 0,
      yardsPerPlayAllowed: 0
    },
    pointsAllowed: {
      total: 0,
      gamesRepresented: 0
    },
    gamesUsed: []
  };
}

function ensureDefense(map, team) {
  if (!map[team]) {
    map[team] = emptyDefenseProfile(team);
  }
  return map[team];
}

function addOpponentOffenseToDefense({ defense, opponentStats, game }) {
  if (!defense || !opponentStats) {
    return;
  }

  const passing = parseCompletionsAttempts(
    opponentStats.passCompletionsAndAttempts
  );
  const sacks = parseSacks(opponentStats.sacksAndYardsLost);
  const rushAttempts = numberValue(opponentStats.rushingAttempts);
  const rushYards = numberValue(opponentStats.rushingYards);
  const rushTD = numberValue(opponentStats.rushTD);
  const passYards = numberValue(opponentStats.passingYards);
  const passTD = numberValue(opponentStats.passTD);
  const interceptionsThrown = numberValue(
    opponentStats.interceptionsThrown
  );
  const totalYards = numberValue(opponentStats.totalYards);
  const totalPlays = numberValue(opponentStats.totalPlays);

  defense.games += 1;
  defense.runDefense.attemptsAllowed += rushAttempts;
  defense.runDefense.yardsAllowed += rushYards;
  defense.runDefense.touchdownsAllowed += rushTD;
  defense.passDefense.attemptsAllowed += passing.attempts;
  defense.passDefense.completionsAllowed += passing.completions;
  defense.passDefense.yardsAllowed += passYards;
  defense.passDefense.touchdownsAllowed += passTD;
  defense.passDefense.interceptions += interceptionsThrown;
  defense.passDefense.sacks += sacks.sacks;
  defense.totalDefense.yardsAllowed += totalYards;
  defense.totalDefense.playsFaced += totalPlays;

  defense.gamesUsed.push({
    gameID: game.gameID,
    week: game.gameWeek,
    season: game.season,
    opponent:
      opponentStats.teamAbv || opponentStats.team || null,
    opponentRushAttempts: rushAttempts,
    opponentRushYards: rushYards,
    opponentRushTD: rushTD,
    opponentPassAttempts: passing.attempts,
    opponentPassCompletions: passing.completions,
    opponentPassYards: passYards,
    opponentPassTD: passTD,
    opponentInterceptions: interceptionsThrown,
    opponentSacksAllowed: sacks.sacks,
    opponentTotalYards: totalYards
  });
}

function addPointsAllowedToDefense({ defense, points }) {
  if (!defense || points === null) {
    return;
  }

  defense.pointsAllowed.total += points;
  defense.pointsAllowed.gamesRepresented += 1;
}

function finalizeDefense(profile) {
  const result = JSON.parse(JSON.stringify(profile));
  const run = result.runDefense;
  const pass = result.passDefense;
  const total = result.totalDefense;

  run.yardsPerCarryAllowed =
    run.attemptsAllowed > 0
      ? Number((run.yardsAllowed / run.attemptsAllowed).toFixed(2))
      : 0;

  pass.yardsPerAttemptAllowed =
    pass.attemptsAllowed > 0
      ? Number((pass.yardsAllowed / pass.attemptsAllowed).toFixed(2))
      : 0;

  pass.completionPctAllowed =
    pass.attemptsAllowed > 0
      ? Number(
          ((pass.completionsAllowed / pass.attemptsAllowed) * 100).toFixed(1)
        )
      : 0;

  total.yardsPerPlayAllowed =
    total.playsFaced > 0
      ? Number((total.yardsAllowed / total.playsFaced).toFixed(2))
      : 0;

  result.perGame = {
    rushAttemptsAllowed:
      result.games > 0
        ? Number((run.attemptsAllowed / result.games).toFixed(1))
        : 0,
    rushYardsAllowed:
      result.games > 0
        ? Number((run.yardsAllowed / result.games).toFixed(1))
        : 0,
    rushTDAllowed:
      result.games > 0
        ? Number((run.touchdownsAllowed / result.games).toFixed(2))
        : 0,
    passAttemptsAllowed:
      result.games > 0
        ? Number((pass.attemptsAllowed / result.games).toFixed(1))
        : 0,
    passYardsAllowed:
      result.games > 0
        ? Number((pass.yardsAllowed / result.games).toFixed(1))
        : 0,
    passTDAllowed:
      result.games > 0
        ? Number((pass.touchdownsAllowed / result.games).toFixed(2))
        : 0,
    interceptions:
      result.games > 0
        ? Number((pass.interceptions / result.games).toFixed(2))
        : 0,
    sacks:
      result.games > 0
        ? Number((pass.sacks / result.games).toFixed(2))
        : 0,
    totalYardsAllowed:
      result.games > 0
        ? Number((total.yardsAllowed / result.games).toFixed(1))
        : 0
  };

  return result;
}

async function getGamesForWeek({ season, week, seasonType }) {
  const result = await tank01Fetch("getNFLGamesForWeek", {
    week: String(week),
    season: String(season),
    seasonType
  });

  return Array.isArray(result.body) ? result.body : [];
}

async function getBoxScore(gameID) {
  const result = await tank01Fetch("getNFLBoxScore", {
    gameID,
    playByPlay: "false"
  });

  return result.body || null;
}

function isPlaceKickerStatLine(kicking) {
  if (!kicking || typeof kicking !== "object") {
    return false;
  }

  return (
    kicking.fgAttempts !== undefined ||
    kicking.fgMade !== undefined ||
    kicking.xpAttempts !== undefined ||
    kicking.xpMade !== undefined
  );
}

const FG_SCORE_TEXT_PATTERN = /(\d+)\s*Yd Field Goal/i;

function madeFgDistancesForKicker(scoringPlays, playerID) {
  if (!Array.isArray(scoringPlays)) {
    return [];
  }

  const distances = [];

  scoringPlays.forEach(function (play) {
    if (
      !play ||
      play.scoreType !== "FG" ||
      !Array.isArray(play.playerIDs) ||
      play.playerIDs.indexOf(playerID) === -1
    ) {
      return;
    }

    const match = FG_SCORE_TEXT_PATTERN.exec(play.score || "");
    if (match) {
      distances.push(Number(match[1]));
    }
  });

  return distances;
}

function buildGameKickerEvidence({ boxScore, game }) {
  const playerStats =
    boxScore &&
    boxScore.playerStats &&
    typeof boxScore.playerStats === "object"
      ? boxScore.playerStats
      : {};

  const homePts = numOrNull(boxScore && boxScore.homePts);
  const awayPts = numOrNull(boxScore && boxScore.awayPts);
  const evidence = [];

  Object.keys(playerStats).forEach(function (playerID) {
    const player = playerStats[playerID];
    const kicking = player && player.Kicking;

    if (!isPlaceKickerStatLine(kicking)) {
      return;
    }

    evidence.push({
      gameID: game.gameID,
      week: game.gameWeek || null,
      home: game.home,
      away: game.away,
      homePts,
      awayPts,
      playerID,
      name: player.longName || null,
      team: player.teamAbv || player.team || null,
      fgAttempts: numOrNull(kicking.fgAttempts),
      fgMade: numOrNull(kicking.fgMade),
      fgMissed: numOrNull(kicking.fgMissed),
      xpAttempts: numOrNull(kicking.xpAttempts),
      xpMade: numOrNull(kicking.xpMade),
      xpMissed: numOrNull(kicking.xpMissed),
      fgLong: numOrNull(kicking.fgLong),
      madeFgDistances: madeFgDistancesForKicker(
        boxScore && boxScore.scoringPlays,
        playerID
      )
    });
  });

  return evidence;
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runner() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) {
        return;
      }

      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        results[index] = { error };
      }
    }
  }

  const runnerCount = Math.min(limit, items.length);
  const runners = [];

  for (let i = 0; i < runnerCount; i += 1) {
    runners.push(runner());
  }

  await Promise.all(runners);
  return results;
}

async function buildWeeklyDefense({
  season,
  week,
  seasonType = DEFAULT_SEASON_TYPE
}) {
  if (!process.env.TANK01_API_KEY) {
    throw new Error("TANK01_API_KEY is not configured.");
  }

  const normalizedSeason = String(season || new Date().getFullYear());
  const normalizedWeek = Number(week);
  const normalizedSeasonType = String(
    seasonType || DEFAULT_SEASON_TYPE
  )
    .trim()
    .toLowerCase();

  if (
    !Number.isInteger(normalizedWeek) ||
    normalizedWeek < 1 ||
    normalizedWeek > 18
  ) {
    throw new Error("week must be an integer from 1 through 18.");
  }

  if (
    !["reg", "pre", "post", "all"].includes(normalizedSeasonType)
  ) {
    throw new Error("seasonType must be reg, pre, post, or all.");
  }

  const games = await getGamesForWeek({
    season: normalizedSeason,
    week: normalizedWeek,
    seasonType: normalizedSeasonType
  });

  const completedGames = games.filter(isCompletedGame);
  const defenseMap = {};
  const kickerEvidenceByGame = [];

  const processed = await mapWithConcurrency(
    completedGames,
    BOX_SCORE_CONCURRENCY,
    async function (game) {
      try {
        const boxScore = await getBoxScore(game.gameID);
        const teamStats = boxScore && boxScore.teamStats;

        if (!teamStats || !teamStats.home || !teamStats.away) {
          return {
            gameID: game.gameID,
            away: game.away,
            home: game.home,
            status: "missing_team_stats"
          };
        }

        kickerEvidenceByGame.push(
          ...buildGameKickerEvidence({ boxScore, game })
        );

        const homeDefense = ensureDefense(defenseMap, game.home);
        const awayDefense = ensureDefense(defenseMap, game.away);

        addOpponentOffenseToDefense({
          defense: homeDefense,
          opponentStats: teamStats.away,
          game
        });

        addOpponentOffenseToDefense({
          defense: awayDefense,
          opponentStats: teamStats.home,
          game
        });

        addPointsAllowedToDefense({
          defense: homeDefense,
          points: numOrNull(boxScore.awayPts)
        });

        addPointsAllowedToDefense({
          defense: awayDefense,
          points: numOrNull(boxScore.homePts)
        });

        return {
          gameID: game.gameID,
          away: game.away,
          home: game.home,
          gameStatus: game.gameStatus,
          status: "processed"
        };
      } catch (error) {
        return {
          gameID: game.gameID,
          away: game.away,
          home: game.home,
          status: "error",
          error: error.message
        };
      }
    }
  );

  const defenses = {};
  Object.keys(defenseMap)
    .sort()
    .forEach(function (team) {
      defenses[team] = finalizeDefense(defenseMap[team]);
    });

  const processedCount = processed.filter(function (game) {
    return game && game.status === "processed";
  }).length;

  return {
    evidenceType: "weekly-sage-defense-week",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    season: normalizedSeason,
    week: normalizedWeek,
    seasonType: normalizedSeasonType,
    schedule: {
      gamesReturned: games.length,
      completedGames: completedGames.length,
      processedGames: processedCount
    },
    defenses,
    gameResults: processed,
    kickerEvidence: kickerEvidenceByGame
  };
}

exports.buildWeeklyDefense = buildWeeklyDefense;

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body, null, 2)
  };
}

exports.handler = async function (event) {
  // Provider safety boundary: this HTTP surface is deliberately inert.
  // The scheduled refresh writer imports buildWeeklyDefense() directly.
  return jsonResponse(404, {
    error: "Not found."
  });
};
