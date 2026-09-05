// netlify/functions/data/nfl-2026-schedule.js
//
// Frozen 2026 NFL regular-season schedule snapshot for Inner Sanctum
// Schedule Intelligence. This file contains only week/away/home because
// dates and kickoff times are not needed for preseason schedule difficulty.
//
// Source snapshot: nflverse/nfldata games.csv, 2026 REG rows.
// Team codes are normalized to Inner Sanctum conventions (LAR, WSH).
//
// ZERO network calls. ZERO Tank01 calls.

const SEASON = 2026;
const SEASON_TYPE = "REG";

const SOURCE = Object.freeze({
  provider: "nflverse / nfldata",
  dataset: "games.csv",
  capturedAt: "2026-09-04",
  url: "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
});

const WEEK_GAMES = Object.freeze({
  1: [
    "NE@SEA",
    "SF@LAR",
    "CHI@CAR",
    "TB@CIN",
    "NO@DET",
    "BUF@HOU",
    "BAL@IND",
    "CLE@JAX",
    "ATL@PIT",
    "NYJ@TEN",
    "ARI@LAC",
    "MIA@LV",
    "GB@MIN",
    "WSH@PHI",
    "DAL@NYG",
    "DEN@KC"
  ],

  2: [
    "DET@BUF",
    "CAR@ATL",
    "NO@BAL",
    "MIN@CHI",
    "CIN@HOU",
    "PIT@NE",
    "GB@NYJ",
    "CLE@TB",
    "PHI@TEN",
    "JAX@DEN",
    "LV@LAC",
    "SEA@ARI",
    "WSH@DAL",
    "MIA@SF",
    "IND@KC",
    "NYG@LAR"
  ],

  3: [
    "ATL@GB",
    "LAC@BUF",
    "CAR@CLE",
    "NYJ@DET",
    "HOU@IND",
    "NE@JAX",
    "KC@MIA",
    "TEN@NYG",
    "CIN@PIT",
    "SEA@WSH",
    "ARI@SF",
    "MIN@TB",
    "BAL@DAL",
    "LV@NO",
    "LAR@DEN",
    "PHI@CHI"
  ],

  4: [
    "PIT@CLE",
    "IND@WSH",
    "TEN@BAL",
    "NE@BUF",
    "NYJ@CHI",
    "JAX@CIN",
    "DAL@HOU",
    "ARI@NYG",
    "LAR@PHI",
    "GB@TB",
    "MIA@MIN",
    "KC@LV",
    "LAC@SEA",
    "DEN@SF",
    "DET@CAR",
    "ATL@NO"
  ],

  5: [
    "TB@DAL",
    "PHI@JAX",
    "CIN@MIA",
    "LV@NE",
    "MIN@NO",
    "CLE@NYJ",
    "IND@PIT",
    "HOU@TEN",
    "NYG@WSH",
    "DEN@LAC",
    "DET@ARI",
    "CHI@GB",
    "SF@SEA",
    "BAL@ATL",
    "BUF@LAR"
  ],

  6: [
    "SEA@DEN",
    "HOU@JAX",
    "CHI@ATL",
    "BAL@CLE",
    "TEN@IND",
    "NYJ@NE",
    "NO@NYG",
    "CAR@PHI",
    "PIT@TB",
    "ARI@LAR",
    "LAC@KC",
    "BUF@LV",
    "DAL@GB",
    "WSH@SF"
  ],

  7: [
    "NE@CHI",
    "PIT@NO",
    "SF@ATL",
    "CIN@BAL",
    "TB@CAR",
    "NYG@HOU",
    "IND@MIN",
    "MIA@NYJ",
    "CLE@TEN",
    "DEN@ARI",
    "GB@DET",
    "LAR@LV",
    "KC@SEA",
    "DAL@PHI"
  ],

  8: [
    "CAR@GB",
    "BAL@BUF",
    "TEN@CIN",
    "ARI@DAL",
    "MIN@DET",
    "IND@JAX",
    "LV@NYJ",
    "CLE@PIT",
    "ATL@TB",
    "LAC@LAR",
    "KC@DEN",
    "NE@MIA",
    "PHI@WSH",
    "CHI@SEA"
  ],

  9: [
    "JAX@BAL",
    "CIN@ATL",
    "DEN@CAR",
    "DAL@IND",
    "NYJ@KC",
    "DET@MIA",
    "CLE@NO",
    "NYG@PHI",
    "LAR@WSH",
    "HOU@LAC",
    "LV@SF",
    "GB@NE",
    "ARI@SEA",
    "TB@CHI",
    "BUF@MIN"
  ],

  10: [
    "WSH@NYG",
    "NE@DET",
    "KC@ATL",
    "HOU@CLE",
    "MIN@GB",
    "MIA@IND",
    "CAR@NO",
    "BUF@NYJ",
    "JAX@TEN",
    "LAR@ARI",
    "SEA@LV",
    "SF@DAL",
    "PIT@CIN",
    "LAC@BAL"
  ],

  11: [
    "IND@HOU",
    "MIA@BUF",
    "BAL@CAR",
    "NO@CHI",
    "TEN@DAL",
    "TB@DET",
    "ARI@KC",
    "JAX@NYG",
    "NYJ@LAC",
    "LV@DEN",
    "PIT@PHI",
    "MIN@SF",
    "CIN@WSH"
  ],

  12: [
    "GB@LAR",
    "CHI@DET",
    "PHI@DAL",
    "KC@BUF",
    "DEN@PIT",
    "NO@CIN",
    "LV@CLE",
    "BAL@HOU",
    "NYG@IND",
    "NYJ@MIA",
    "ATL@MIN",
    "TEN@JAX",
    "WSH@ARI",
    "SEA@SF",
    "NE@LAC",
    "CAR@TB"
  ],

  13: [
    "KC@LAR",
    "DET@ATL",
    "JAX@CHI",
    "CIN@CLE",
    "GB@NO",
    "SF@NYG",
    "LAC@TB",
    "WSH@TEN",
    "PHI@ARI",
    "MIA@DEN",
    "CAR@MIN",
    "BUF@NE",
    "HOU@PIT",
    "DAL@SEA"
  ],

  14: [
    "MIN@NE",
    "TB@BAL",
    "NO@CAR",
    "ATL@CLE",
    "TEN@DET",
    "CHI@MIA",
    "DEN@NYJ",
    "IND@PHI",
    "HOU@WSH",
    "LAC@LV",
    "KC@CIN",
    "NYG@SEA",
    "LAR@SF",
    "BUF@GB",
    "PIT@JAX"
  ],

  15: [
    "SF@LAC",
    "SEA@PHI",
    "CHI@BUF",
    "CIN@CAR",
    "MIA@GB",
    "JAX@HOU",
    "CLE@NYG",
    "BAL@PIT",
    "NO@TB",
    "IND@TEN",
    "ATL@WSH",
    "NYJ@ARI",
    "DAL@LAR",
    "DEN@LV",
    "DET@MIN",
    "NE@KC"
  ],

  16: [
    "HOU@PHI",
    "GB@CHI",
    "BUF@DEN",
    "LAR@SEA",
    "TB@ATL",
    "CLE@BAL",
    "CIN@IND",
    "LAC@MIA",
    "WSH@MIN",
    "ARI@NO",
    "NE@NYJ",
    "CAR@PIT",
    "TEN@LV",
    "SF@KC",
    "JAX@DAL",
    "NYG@DET"
  ],

  17: [
    "BAL@CIN",
    "NO@ATL",
    "SEA@CAR",
    "IND@CLE",
    "NYG@DAL",
    "WSH@JAX",
    "KC@LAC",
    "BUF@MIA",
    "DEN@NE",
    "MIN@NYJ",
    "LAR@TB",
    "PIT@TEN",
    "LV@ARI",
    "DET@CHI",
    "PHI@SF",
    "HOU@GB"
  ],

  18: [
    "SF@ARI",
    "PIT@BAL",
    "NYJ@BUF",
    "ATL@CAR",
    "CLE@CIN",
    "LAC@DEN",
    "DET@GB",
    "TEN@HOU",
    "JAX@IND",
    "LV@KC",
    "SEA@LAR",
    "CHI@MIN",
    "MIA@NE",
    "TB@NO",
    "PHI@NYG",
    "DAL@WSH"
  ]
});

function parseGame(week, value) {
  const parts = String(value).split("@");

  if (parts.length !== 2) {
    throw new Error(
      `Invalid 2026 schedule game: ${value}`
    );
  }

  return Object.freeze({
    week: Number(week),
    away: parts[0],
    home: parts[1]
  });
}

const GAMES = Object.freeze(
  Object.entries(WEEK_GAMES)
    .flatMap(([week, games]) =>
      games.map((game) =>
        parseGame(week, game)
      )
    )
    .sort(
      (a, b) =>
        a.week - b.week ||
        a.away.localeCompare(b.away) ||
        a.home.localeCompare(b.home)
    )
);

module.exports = {
  SEASON,
  SEASON_TYPE,
  SOURCE,
  WEEK_GAMES,
  GAMES
};
