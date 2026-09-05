"use strict";

/**
 * Inner Sanctum
 * 2026 RB Schedule Intelligence — Human Review Board
 *
 * PURPOSE
 * -------
 * Produce a readable 32-team Schedule Intelligence board using the
 * exact same working invocation pattern as:
 *
 *   tests/sage-rb-schedule-2026.test.js
 *
 * THIS FILE:
 * - changes no production logic
 * - makes no network calls
 * - makes no Tank01 calls
 * - writes no data
 * - only prints the already-tested Schedule Intelligence output
 */

const {
  buildLeagueRbScheduleIntelligence
} = require(
  "../netlify/functions/sage-rb-schedule-preseason.js"
);

const {
  buildRbDefenseDifficulty
} = require(
  "../netlify/functions/sage-rb-defense-difficulty.js"
);

const {
  GAMES
} = require(
  "../netlify/functions/data/nfl-2026-schedule.js"
);

const DEF_MARKET_2026 = Object.freeze([
  {
    name: "Houston Texans",
    team: "HOU",
    adp: 153.8
  },
  {
    name: "Denver Broncos",
    team: "DEN",
    adp: 164.8
  },
  {
    name: "Los Angeles Rams",
    team: "LAR",
    adp: 165.8
  },
  {
    name: "Seattle Seahawks",
    team: "SEA",
    adp: 168.4
  },
  {
    name: "Philadelphia Eagles",
    team: "PHI",
    adp: 176.2
  },
  {
    name: "Minnesota Vikings",
    team: "MIN",
    adp: 187.4
  },
  {
    name: "Pittsburgh Steelers",
    team: "PIT",
    adp: 187.7
  },
  {
    name: "New England Patriots",
    team: "NE",
    adp: 187.8
  },
  {
    name: "Jacksonville Jaguars",
    team: "JAX",
    adp: 189.7
  },
  {
    name: "Los Angeles Chargers",
    team: "LAC",
    adp: 192.2
  },
  {
    name: "Baltimore Ravens",
    team: "BAL",
    adp: 197.7
  },
  {
    name: "Green Bay Packers",
    team: "GB",
    adp: 208.1
  },
  {
    name: "Kansas City Chiefs",
    team: "KC",
    adp: 210.5
  },
  {
    name: "Detroit Lions",
    team: "DET",
    adp: 220.2
  },
  {
    name: "Cleveland Browns",
    team: "CLE",
    adp: 222.0
  },
  {
    name: "Buffalo Bills",
    team: "BUF",
    adp: 225.1
  },
  {
    name: "Tennessee Titans",
    team: "TEN",
    adp: 240.6
  },
  {
    name: "Dallas Cowboys",
    team: "DAL",
    adp: 253.9
  },
  {
    name: "New Orleans Saints",
    team: "NO",
    adp: 263.3
  },
  {
    name: "San Francisco 49ers",
    team: "SF",
    adp: 264.9
  },
  {
    name: "New York Giants",
    team: "NYG",
    adp: 267.1
  },
  {
    name: "Cincinnati Bengals",
    team: "CIN",
    adp: 272.0
  },
  {
    name: "Chicago Bears",
    team: "CHI",
    adp: 272.7
  },
  {
    name: "Las Vegas Raiders",
    team: "LV",
    adp: 272.9
  },
  {
    name: "Atlanta Falcons",
    team: "ATL",
    adp: 274.2
  },
  {
    name: "Washington Commanders",
    team: "WAS",
    adp: 276.5
  },
  {
    name: "Indianapolis Colts",
    team: "IND",
    adp: 279.1
  },
  {
    name: "Carolina Panthers",
    team: "CAR",
    adp: 297.3
  },
  {
    name: "Tampa Bay Buccaneers",
    team: "TB",
    adp: 302.9
  },
  {
    name: "Arizona Cardinals",
    team: "ARI",
    adp: 304.0
  },
  {
    name: "New York Jets",
    team: "NYJ",
    adp: 319.4
  },
  {
    name: "Miami Dolphins",
    team: "MIA",
    adp: 324.1
  }
]);

function fail(message) {
  console.error(
    "\nSCHEDULE BOARD ERROR:\n" +
    message +
    "\n"
  );

  process.exit(1);
}

function rankLabel(window) {
  if (!window) {
    return "-";
  }

  if (window.scheduleRankLabel) {
    return window.scheduleRankLabel;
  }

  if (
    Number.isFinite(
      window.scheduleRank
    )
  ) {
    return String(
      window.scheduleRank
    );
  }

  return "-";
}

function outlookLabel(window) {
  if (!window) {
    return "-";
  }

  return (
    window.outlook ||
    window.scheduleOutlook ||
    "-"
  );
}

function scoreValue(window) {
  if (
    !window ||
    !Number.isFinite(
      window.averageDifficultyScore
    )
  ) {
    return null;
  }

  return Number(
    window.averageDifficultyScore
      .toFixed(4)
  );
}

function displayWindow(window) {
  return (
    rankLabel(window) +
    " " +
    outlookLabel(window)
  );
}

/**
 * STEP 1
 * Build defensive difficulty exactly as the passing test does.
 */
const defense =
  buildRbDefenseDifficulty(
    DEF_MARKET_2026
  );

if (
  !defense ||
  defense.available !== true
) {
  fail(
    "RB defensive difficulty board was unavailable.\n" +
    JSON.stringify(
      defense,
      null,
      2
    )
  );
}

/**
 * STEP 2
 * Build league Schedule Intelligence using the exact same function
 * signature as the known-good end-to-end test.
 */
const result =
  buildLeagueRbScheduleIntelligence(
    GAMES,
    defense
  );

if (
  !result ||
  result.available !== true
) {
  fail(
    "League RB Schedule Intelligence was unavailable.\n" +
    JSON.stringify(
      result,
      null,
      2
    )
  );
}

if (
  !Array.isArray(
    result.teams
  ) ||
  result.teams.length !== 32
) {
  fail(
    "Expected 32 team rows; received " +
    (
      Array.isArray(
        result.teams
      )
        ? result.teams.length
        : 0
    ) +
    "."
  );
}

/**
 * Flatten only the fields already proven by the passing test.
 */
const board =
  result.teams.map(
    function (team) {
      const windows =
        team.windows;

      return {
        team:
          team.team,

        early:
          windows.earlySeason,

        full:
          windows.fullSeason,

        playoffs1416:
          windows.playoffs14to16,

        playoffs1517:
          windows.playoffs15to17,

        playoffs1417:
          windows.playoffs14to17
      };
    }
  );

/**
 * Sort by full-season Schedule Intelligence rank.
 *
 * Schedule rank direction:
 *   #1 = easiest / best RB schedule
 */
board.sort(
  function (a, b) {
    const aRank =
      a.full.scheduleRank;

    const bRank =
      b.full.scheduleRank;

    if (
      aRank !== bRank
    ) {
      return (
        aRank -
        bRank
      );
    }

    return (
      a.team.localeCompare(
        b.team
      )
    );
  }
);

console.log(
  "\n=============================================================="
);

console.log(
  "INNER SANCTUM — 2026 RB SCHEDULE INTELLIGENCE"
);

console.log(
  "Schedule rank: #1 = easiest / most favorable RB schedule"
);

console.log(
  "Difficulty score: lower = easier schedule"
);

console.log(
  "==============================================================\n"
);

/**
 * Primary 32-team review board.
 */
console.table(
  board.map(
    function (row) {
      return {
        Team:
          row.team,

        "Weeks 1-4":
          displayWindow(
            row.early
          ),

        "Full Season":
          displayWindow(
            row.full
          ),

        "Weeks 14-16":
          displayWindow(
            row.playoffs1416
          ),

        "Weeks 15-17":
          displayWindow(
            row.playoffs1517
          ),

        "Weeks 14-17":
          displayWindow(
            row.playoffs1417
          )
      };
    }
  )
);

/**
 * Detailed score board.
 */
console.log(
  "\nDETAILED DIFFICULTY SCORES"
);

console.table(
  board.map(
    function (row) {
      return {
        Team:
          row.team,

        "W1-4 Rank":
          rankLabel(
            row.early
          ),

        "W1-4 Score":
          scoreValue(
            row.early
          ),

        "Full Rank":
          rankLabel(
            row.full
          ),

        "Full Score":
          scoreValue(
            row.full
          ),

        "W14-16 Rank":
          rankLabel(
            row.playoffs1416
          ),

        "W14-16 Score":
          scoreValue(
            row.playoffs1416
          ),

        "W15-17 Rank":
          rankLabel(
            row.playoffs1517
          ),

        "W15-17 Score":
          scoreValue(
            row.playoffs1517
          ),

        "W14-17 Rank":
          rankLabel(
            row.playoffs1417
          ),

        "W14-17 Score":
          scoreValue(
            row.playoffs1417
          )
      };
    }
  )
);

/**
 * Specific comparison we have already validated in the test.
 */
const sf =
  board.find(
    function (row) {
      return (
        row.team ===
        "SF"
      );
    }
  );

const mia =
  board.find(
    function (row) {
      return (
        row.team ===
        "MIA"
      );
    }
  );

if (
  !sf ||
  !mia
) {
  fail(
    "Could not locate SF and MIA in the completed board."
  );
}

console.log(
  "\nMcCAFFREY vs ACHANE"
);

console.table([
  {
    Player:
      "Christian McCaffrey",

    Team:
      "SF",

    "Weeks 1-4":
      displayWindow(
        sf.early
      ),

    "Full Season":
      displayWindow(
        sf.full
      ),

    "Weeks 14-16":
      displayWindow(
        sf.playoffs1416
      ),

    "Weeks 15-17":
      displayWindow(
        sf.playoffs1517
      ),

    "Weeks 14-17":
      displayWindow(
        sf.playoffs1417
      )
  },

  {
    Player:
      "De'Von Achane",

    Team:
      "MIA",

    "Weeks 1-4":
      displayWindow(
        mia.early
      ),

    "Full Season":
      displayWindow(
        mia.full
      ),

    "Weeks 14-16":
      displayWindow(
        mia.playoffs1416
      ),

    "Weeks 15-17":
      displayWindow(
        mia.playoffs1517
      ),

    "Weeks 14-17":
      displayWindow(
        mia.playoffs1417
      )
  }
]);

console.log(
  "\nSchedule Intelligence board generated successfully.\n"
);
