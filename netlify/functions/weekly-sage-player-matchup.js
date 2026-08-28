// netlify/functions/weekly-sage-player-matchup.js
//
// WEEKLY SAGE — PLAYER ↔ OPPONENT MATCHUP MAPPING
//
// PURPOSE
// -------
// Connect an offensive player's team + position to:
//   1. that team's opponent for the requested week
//   2. the correct Weekly SAGE defensive matchup profile
//
// THIS IS AN EVIDENCE-MAPPING LAYER.
//
// It does NOT:
// - calculate defensive matchup scores
// - change Weekly SAGE defensive weights
// - rank fantasy players
// - create START/SIT recommendations
// - modify weekly.html
//
// Example:
// ?season=2025&week=8&team=ATL&position=RB
//
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_SEASON_TYPE = "reg";

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

const VALID_POSITIONS =
  new Set([
    "QB",
    "RB",
    "WR",
    "TE"
  ]);

// Tank01 / NFL abbreviation normalization.
// Keep our internal keys aligned with the matchup-defense function.
const TEAM_ALIASES = {
  ARI: "ARI",
  ATL: "ATL",
  BAL: "BAL",
  BUF: "BUF",
  CAR: "CAR",
  CHI: "CHI",
  CIN: "CIN",
  CLE: "CLE",
  DAL: "DAL",
  DEN: "DEN",
  DET: "DET",
  GB: "GB",
  GBP: "GB",
  HOU: "HOU",
  IND: "IND",
  JAX: "JAX",
  JAC: "JAX",
  KC: "KC",
  KAN: "KC",
  LAC: "LAC",
  LAR: "LAR",
  LV: "LV",
  LVR: "LV",
  MIA: "MIA",
  MIN: "MIN",
  NE: "NE",
  NEP: "NE",
  NO: "NO",
  NOR: "NO",
  NYG: "NYG",
  NYJ: "NYJ",
  PHI: "PHI",
  PIT: "PIT",
  SEA: "SEA",
  SF: "SF",
  SFO: "SF",
  TB: "TB",
  TBB: "TB",
  TEN: "TEN",
  WSH: "WSH",
  WAS: "WSH"
};

function normalizeTeam(value) {
  const team =
    String(value || "")
      .trim()
      .toUpperCase();

  return TEAM_ALIASES[team] || team;
}

function normalizePosition(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function getBaseUrl(event) {
  const headers =
    event.headers || {};

  const proto =
    headers["x-forwarded-proto"] ||
    headers["X-Forwarded-Proto"] ||
    "https";

  const host =
    headers.host ||
    headers.Host;

  if (!host) {
    throw new Error(
      "Could not determine host."
    );
  }

  return `${proto}://${host}`;
}

async function fetchJson(url) {
  const response =
    await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    });

  let data = null;

  try {
    data =
      await response.json();
  } catch (error) {
    data = null;
  }

  if (!response.ok) {
    const detail =
      data &&
      (
        data.detail ||
        data.error
      )
        ? (
            data.detail ||
            data.error
          )
        : `HTTP ${response.status}`;

    throw new Error(detail);
  }

  return data;
}

async function fetchSchedule({
  baseUrl,
  season,
  week,
  seasonType
}) {
  const url =
    `${baseUrl}/.netlify/functions/weekly-sage-schedule` +
    `?season=${encodeURIComponent(season)}` +
    `&week=${encodeURIComponent(week)}` +
    `&seasonType=${encodeURIComponent(seasonType)}`;

  return fetchJson(url);
}

async function fetchMatchupDefense({
  baseUrl,
  season,
  week,
  seasonType
}) {
  const url =
    `${baseUrl}/.netlify/functions/weekly-sage-matchup-defense` +
    `?season=${encodeURIComponent(season)}` +
    `&week=${encodeURIComponent(week)}` +
    `&seasonType=${encodeURIComponent(seasonType)}`;

  return fetchJson(url);
}

function extractGames(schedule) {
  if (!schedule) {
    return [];
  }

  if (Array.isArray(schedule)) {
    return schedule;
  }

  if (Array.isArray(schedule.games)) {
    return schedule.games;
  }

  if (
    schedule.body &&
    Array.isArray(schedule.body)
  ) {
    return schedule.body;
  }

  return [];
}

function findGameForTeam(
  games,
  team
) {
  return (
    games.find(game => {
      const away =
        normalizeTeam(
          game.away ||
          game.awayTeam
        );

      const home =
        normalizeTeam(
          game.home ||
          game.homeTeam
        );

      return (
        away === team ||
        home === team
      );
    }) ||
    null
  );
}

function getOpponent(
  game,
  team
) {
  if (!game) {
    return null;
  }

  const away =
    normalizeTeam(
      game.away ||
      game.awayTeam
    );

  const home =
    normalizeTeam(
      game.home ||
      game.homeTeam
    );

  if (away === team) {
    return {
      opponent: home,
      location: "away"
    };
  }

  if (home === team) {
    return {
      opponent: away,
      location: "home"
    };
  }

  return null;
}

function profileForPosition(
  position,
  opponentMatchup
) {
  if (!opponentMatchup) {
    return null;
  }

  switch (position) {
    case "RB":
      return {
        profileType: "run",
        ...opponentMatchup.run
      };

    case "QB":
      return {
        profileType: "pass",
        ...opponentMatchup.pass
      };

    case "WR":
    case "TE":
      return {
        profileType: "receiving",
        ...opponentMatchup.receiving
      };

    default:
      return null;
  }
}

function explanationForPosition(
  position,
  opponentMatchup
) {
  if (
    !opponentMatchup ||
    !opponentMatchup.explanation
  ) {
    return null;
  }

  if (position === "RB") {
    return (
      opponentMatchup
        .explanation.run ||
      null
    );
  }

  if (
    position === "QB" ||
    position === "WR" ||
    position === "TE"
  ) {
    return (
      opponentMatchup
        .explanation.pass ||
      null
    );
  }

  return null;
}

function jsonResponse(
  statusCode,
  body,
  cacheControl
) {
  return {
    statusCode,

    headers: {
      "Content-Type":
        "application/json",

      "Cache-Control":
        cacheControl || "no-store"
    },

    body:
      JSON.stringify(
        body,
        null,
        2
      )
  };
}

function playerMatchupError(
  statusCode,
  message,
  details = {}
) {
  const error =
    new Error(message);

  error.playerMatchupStatusCode =
    statusCode;

  error.playerMatchupDetails =
    details;

  return error;
}

async function buildPlayerMatchup({
  baseUrl,
  season,
  week,
  seasonType = DEFAULT_SEASON_TYPE,
  team,
  position,
  prebuiltSchedule = null,
  prebuiltMatchupDefense = null
}) {
  const normalizedSeason =
    String(
      season ||
      new Date().getFullYear()
    );

  const normalizedWeek =
    Number(week);

  const normalizedSeasonType =
    String(
      seasonType ||
      DEFAULT_SEASON_TYPE
    );

  const normalizedTeam =
    normalizeTeam(team);

  const normalizedPosition =
    normalizePosition(position);

  if (
    !Number.isInteger(normalizedWeek) ||
    normalizedWeek < 1 ||
    normalizedWeek > 18
  ) {
    throw playerMatchupError(
      400,
      "week must be an integer from 1 through 18."
    );
  }

  if (!normalizedTeam) {
    throw playerMatchupError(
      400,
      "team is required."
    );
  }

  if (
    !VALID_POSITIONS.has(
      normalizedPosition
    )
  ) {
    throw playerMatchupError(
      400,
      "position must be QB, RB, WR, or TE."
    );
  }

  const [
    schedule,
    matchupDefense
  ] =
    await Promise.all([
      prebuiltSchedule
        ? Promise.resolve(
            prebuiltSchedule
          )
        : fetchSchedule({
            baseUrl,
            season:
              normalizedSeason,
            week:
              normalizedWeek,
            seasonType:
              normalizedSeasonType
          }),

      prebuiltMatchupDefense
        ? Promise.resolve(
            prebuiltMatchupDefense
          )
        : fetchMatchupDefense({
            baseUrl,
            season:
              normalizedSeason,
            week:
              normalizedWeek,
            seasonType:
              normalizedSeasonType
          })
    ]);

  const games =
    extractGames(schedule);

  const game =
    findGameForTeam(
      games,
      normalizedTeam
    );

  if (!game) {
    throw playerMatchupError(
      404,
      "No game found for team in requested week.",
      {
        season:
          normalizedSeason,
        week:
          normalizedWeek,
        team:
          normalizedTeam,
        position:
          normalizedPosition
      }
    );
  }

  const opponentInfo =
    getOpponent(
      game,
      normalizedTeam
    );

  if (
    !opponentInfo ||
    !opponentInfo.opponent
  ) {
    throw new Error(
      "Could not resolve opponent."
    );
  }

  const opponent =
    opponentInfo.opponent;

  const matchup =
    matchupDefense &&
    matchupDefense.matchups
      ? matchupDefense
          .matchups[
            opponent
          ]
      : null;

  if (!matchup) {
    throw playerMatchupError(
      404,
      "No defensive matchup evidence found for opponent.",
      {
        season:
          normalizedSeason,
        week:
          normalizedWeek,
        team:
          normalizedTeam,
        position:
          normalizedPosition,
        opponent
      }
    );
  }

  const profile =
    profileForPosition(
      normalizedPosition,
      matchup
    );

  const explanation =
    explanationForPosition(
      normalizedPosition,
      matchup
    );

  return {
    evidenceType:
      "weekly-sage-player-matchup",

    schemaVersion: 1,

    generatedAt:
      new Date()
        .toISOString(),

    season:
      normalizedSeason,

    week:
      normalizedWeek,

    seasonType:
      normalizedSeasonType,

    playerContext: {
      team:
        normalizedTeam,

      position:
        normalizedPosition,

      opponent,

      location:
        opponentInfo.location,

      gameID:
        game.gameID ||
        null,

      gameDate:
        game.gameDate ||
        null,

      gameTime:
        game.gameTime ||
        null
    },

    matchupEvidence: {
      opponent,

      profileType:
        profile
          ? profile.profileType
          : null,

      score:
        profile
          ? profile.score
          : null,

      signal:
        profile
          ? profile.signal
          : null,

      label:
        profile
          ? profile.label
          : null,

      confidence:
        profile
          ? profile.confidence
          : null,

      explanation,

      source:
        normalizedPosition === "WR" ||
        normalizedPosition === "TE"
          ? "overall_pass_defense_v1"
          : (
              normalizedPosition === "QB"
                ? "overall_pass_defense"
                : "run_defense"
            )
    },

    /*
      Keep the underlying opponent profile available for
      diagnostics and later SAGE composition.

      This is evidence only.
    */
    opponentDefense: {
      team:
        matchup.team,

      games:
        matchup.games,

      run:
        matchup.run,

      pass:
        matchup.pass,

      receiving:
        matchup.receiving
    }
  };
}

exports.buildPlayerMatchup =
  buildPlayerMatchup;

exports.handler =
  async function (event) {
    if (
      event.httpMethod &&
      event.httpMethod !== "GET"
    ) {
      return jsonResponse(
        405,
        {
          error:
            "Method not allowed."
        }
      );
    }

    const query =
      event.queryStringParameters ||
      {};

    const season =
      String(
        query.season ||
        new Date().getFullYear()
      );

    const week =
      Number(query.week);

    const seasonType =
      String(
        query.seasonType ||
        DEFAULT_SEASON_TYPE
      );

    const team =
      normalizeTeam(
        query.team
      );

    const position =
      normalizePosition(
        query.position
      );

    if (
      !Number.isInteger(week) ||
      week < 1 ||
      week > 18
    ) {
      return jsonResponse(
        400,
        {
          error:
            "week must be an integer from 1 through 18."
        }
      );
    }

    if (!team) {
      return jsonResponse(
        400,
        {
          error:
            "team is required."
        }
      );
    }

    if (
      !VALID_POSITIONS.has(
        position
      )
    ) {
      return jsonResponse(
        400,
        {
          error:
            "position must be QB, RB, WR, or TE."
        }
      );
    }

    try {
      const baseUrl =
        getBaseUrl(event);

      const body =
        await buildPlayerMatchup({
          baseUrl,
          season,
          week,
          seasonType,
          team,
          position
        });

      return jsonResponse(
        200,
        body,
        CACHE_CONTROL
      );
    } catch (error) {
      if (
        error &&
        error.playerMatchupStatusCode
      ) {
        return jsonResponse(
          error.playerMatchupStatusCode,
          {
            error:
              error.message,
            ...(
              error.playerMatchupDetails ||
              {}
            )
          }
        );
      }

      console.error(
        "weekly-sage-player-matchup failed:",
        error
      );

      return jsonResponse(
        502,
        {
          error:
            "Could not build Weekly SAGE player matchup evidence.",

          detail:
            error.message
        }
      );
    }
  };
