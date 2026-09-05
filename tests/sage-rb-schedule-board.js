"use strict";

/**
 * Inner Sanctum
 * 2026 RB Schedule Intelligence — Human Review Board
 *
 * PURPOSE
 * -------
 * Produce a readable 32-team Schedule Intelligence board from the
 * already-tested preseason RB schedule model.
 *
 * THIS FILE:
 * - changes no model logic
 * - makes no network calls
 * - makes no Tank01 calls
 * - writes no data
 * - only reads the existing modules and prints results
 */

const {
  buildRbDefenseDifficulty,
} = require(
  "../netlify/functions/sage-rb-defense-difficulty.js"
);

const {
  buildLeagueRbScheduleIntelligence,
} = require(
  "../netlify/functions/sage-rb-schedule-preseason.js"
);

const {
  GAMES,
} = require(
  "../netlify/functions/data/nfl-2026-schedule.js"
);

/**
 * Current 2026 Draft Command Center DEF market board.
 *
 * Lower ADP = stronger market perception.
 */
const DEF_MARKET = [
  { name: "Houston Texans", team: "HOU", adp: 153.8 },
  { name: "Denver Broncos", team: "DEN", adp: 164.8 },
  { name: "Los Angeles Rams", team: "LAR", adp: 165.8 },
  { name: "Seattle Seahawks", team: "SEA", adp: 168.4 },
  { name: "Philadelphia Eagles", team: "PHI", adp: 176.2 },
  { name: "Minnesota Vikings", team: "MIN", adp: 187.4 },
  { name: "Pittsburgh Steelers", team: "PIT", adp: 187.7 },
  { name: "New England Patriots", team: "NE", adp: 187.8 },
  { name: "Jacksonville Jaguars", team: "JAX", adp: 189.7 },
  { name: "Los Angeles Chargers", team: "LAC", adp: 192.2 },
  { name: "Baltimore Ravens", team: "BAL", adp: 197.7 },
  { name: "Green Bay Packers", team: "GB", adp: 208.1 },
  { name: "Kansas City Chiefs", team: "KC", adp: 210.5 },
  { name: "Detroit Lions", team: "DET", adp: 220.2 },
  { name: "Cleveland Browns", team: "CLE", adp: 222.0 },
  { name: "Buffalo Bills", team: "BUF", adp: 225.1 },
  { name: "Tennessee Titans", team: "TEN", adp: 240.6 },
  { name: "Dallas Cowboys", team: "DAL", adp: 253.9 },
  { name: "New Orleans Saints", team: "NO", adp: 263.3 },
  { name: "San Francisco 49ers", team: "SF", adp: 264.9 },
  { name: "New York Giants", team: "NYG", adp: 267.1 },
  { name: "Cincinnati Bengals", team: "CIN", adp: 272.0 },
  { name: "Chicago Bears", team: "CHI", adp: 272.7 },
  { name: "Las Vegas Raiders", team: "LV", adp: 272.9 },
  { name: "Atlanta Falcons", team: "ATL", adp: 274.2 },
  { name: "Washington Commanders", team: "WSH", adp: 276.5 },
  { name: "Indianapolis Colts", team: "IND", adp: 279.1 },
  { name: "Carolina Panthers", team: "CAR", adp: 297.3 },
  { name: "Tampa Bay Buccaneers", team: "TB", adp: 302.9 },
  { name: "Arizona Cardinals", team: "ARI", adp: 304.0 },
  { name: "New York Jets", team: "NYJ", adp: 319.4 },
  { name: "Miami Dolphins", team: "MIA", adp: 324.1 },
];

function fail(message) {
  console.error(
    "\nSCHEDULE BOARD ERROR:\n" +
      message +
      "\n"
  );

  process.exit(1);
}

function getWindow(teamRow, key) {
  if (
    !teamRow ||
    !teamRow.windows ||
    !teamRow.windows[key]
  ) {
    return null;
  }

  return teamRow.windows[key];
}

function rankLabel(window) {
  if (!window) {
    return "-";
  }

  if (window.scheduleRankLabel) {
    return window.scheduleRankLabel;
  }

  if (window.rankLabel) {
    return window.rankLabel;
  }

  if (
    window.scheduleRank !== undefined &&
    window.scheduleRank !== null
  ) {
    return String(
      window.scheduleRank
    );
  }

  return "-";
}

function outlook(window) {
  if (!window) {
    return "-";
  }

  return (
    window.outlook ||
    window.scheduleOutlook ||
    "-"
  );
}

function score(window) {
  if (!window) {
    return null;
  }

  const value =
    window.averageDifficultyScore !== undefined
      ? window.averageDifficultyScore
      : window.difficultyScore !== undefined
        ? window.difficultyScore
        : window.averageDifficulty !== undefined
          ? window.averageDifficulty
          : null;

  const numeric =
    Number(value);

  return Number.isFinite(numeric)
    ? numeric
    : null;
}

function formatRank(window) {
  return (
    rankLabel(window) +
    " " +
    outlook(window)
  );
}

function numericRank(label) {
  if (
    label === null ||
    label === undefined
  ) {
    return null;
  }

  const cleaned =
    String(label)
      .replace(
        "T-",
        ""
      )
      .trim();

  const value =
    Number(cleaned);

  return Number.isFinite(value)
    ? value
    : null;
}

/**
 * STEP 1
 * ------
 * Build the 32-team preseason RB defensive difficulty board.
 */
const defenseBoard =
  buildRbDefenseDifficulty(
    DEF_MARKET
  );

if (
  !defenseBoard ||
  defenseBoard.available !== true
) {
  fail(
    "RB defensive difficulty board was unavailable.\n" +
      JSON.stringify(
        defenseBoard,
        null,
        2
      )
  );
}

if (
  !Array.isArray(
    defenseBoard.ratings
  ) ||
  defenseBoard.ratings.length !== 32
) {
  fail(
    "Expected 32 RB defense ratings; received " +
      (
        Array.isArray(
          defenseBoard.ratings
        )
          ? defenseBoard.ratings.length
          : 0
      ) +
      ".\n" +
      JSON.stringify(
        defenseBoard,
        null,
        2
      )
  );
}

/**
 * STEP 2
 * ------
 * Build complete 2026 league Schedule Intelligence.
 *
 * IMPORTANT:
 * buildLeagueRbScheduleIntelligence expects the actual array of
 * defense ratings, not the wrapper returned by
 * buildRbDefenseDifficulty().
 */
const scheduleBoard =
  buildLeagueRbScheduleIntelligence({
    schedule: GAMES,

    defenseRatings:
      defenseBoard.ratings,
  });

if (
  !scheduleBoard ||
  scheduleBoard.available !== true
) {
  fail(
    "League RB Schedule Intelligence was unavailable.\n" +
      JSON.stringify(
        scheduleBoard,
        null,
        2
      )
  );
}

/**
 * Support the current model output shape while keeping this report
 * isolated from production logic.
 */
const teams =
  Array.isArray(
    scheduleBoard.teams
  )
    ? scheduleBoard.teams
    : Array.isArray(
        scheduleBoard.schedules
      )
      ? scheduleBoard.schedules
      : Array.isArray(
          scheduleBoard.teamSchedules
        )
        ? scheduleBoard.teamSchedules
        : [];

if (
  teams.length !== 32
) {
  fail(
    "Expected 32 team schedule rows; received " +
      teams.length +
      ".\n" +
      JSON.stringify(
        scheduleBoard,
        null,
        2
      )
  );
}

/**
 * Normalize the board into a simple human-review shape.
 */
const normalized =
  teams.map(function (row) {
    const team =
      row.team ||
      row.teamAbv ||
      row.teamAbbr ||
      null;

    const early =
      getWindow(
        row,
        "earlySeason"
      );

    const full =
      getWindow(
        row,
        "fullSeason"
      );

    const playoffs1416 =
      getWindow(
        row,
        "playoffs14to16"
      );

    const playoffs1517 =
      getWindow(
        row,
        "playoffs15to17"
      );

    const playoffs1417 =
      getWindow(
        row,
        "playoffs14to17"
      );

    return {
      team,

      earlyRank:
        rankLabel(
          early
        ),

      earlyOutlook:
        outlook(
          early
        ),

      fullRank:
        rankLabel(
          full
        ),

      fullOutlook:
        outlook(
          full
        ),

      p1416Rank:
        rankLabel(
          playoffs1416
        ),

      p1416Outlook:
        outlook(
          playoffs1416
        ),

      p1517Rank:
        rankLabel(
          playoffs1517
        ),

      p1517Outlook:
        outlook(
          playoffs1517
        ),

      p1417Rank:
        rankLabel(
          playoffs1417
        ),

      p1417Outlook:
        outlook(
          playoffs1417
        ),

      earlyScore:
        score(
          early
        ),

      fullScore:
        score(
          full
        ),

      p1416Score:
        score(
          playoffs1416
        ),

      p1517Score:
        score(
          playoffs1517
        ),

      p1417Score:
        score(
          playoffs1417
        ),

      _early:
        early,

      _full:
        full,

      _p1416:
        playoffs1416,

      _p1517:
        playoffs1517,

      _p1417:
        playoffs1417,
    };
  });

/**
 * Sort by Full Season schedule rank.
 *
 * Schedule direction:
 * #1 = easiest / best RB schedule.
 */
normalized.sort(function (a, b) {
  const aRank =
    numericRank(
      a.fullRank
    );

  const bRank =
    numericRank(
      b.fullRank
    );

  if (
    aRank !== null &&
    bRank !== null &&
    aRank !== bRank
  ) {
    return aRank - bRank;
  }

  if (
    aRank !== null &&
    bRank === null
  ) {
    return -1;
  }

  if (
    aRank === null &&
    bRank !== null
  ) {
    return 1;
  }

  return String(
    a.team || ""
  ).localeCompare(
    String(
      b.team || ""
    )
  );
});

/**
 * MAIN HUMAN-REVIEW BOARD
 */
console.log(
  "\n=============================================================="
);

console.log(
  "INNER SANCTUM — 2026 RB SCHEDULE INTELLIGENCE"
);

console.log(
  "Schedule rank direction: #1 = easiest / most favorable"
);

console.log(
  "Defense difficulty direction: #1 = hardest RB defense"
);

console.log(
  "==============================================================\n"
);

console.table(
  normalized.map(function (row) {
    return {
      Team:
        row.team,

      "W1-4":
        row.earlyRank +
        " " +
        row.earlyOutlook,

      Full:
        row.fullRank +
        " " +
        row.fullOutlook,

      "W14-16":
        row.p1416Rank +
        " " +
        row.p1416Outlook,

      "W15-17":
        row.p1517Rank +
        " " +
        row.p1517Outlook,

      "W14-17":
        row.p1417Rank +
        " " +
        row.p1417Outlook,
    };
  })
);

/**
 * CONTINUOUS SCORE REVIEW
 *
 * Higher opponent difficulty score = harder schedule.
 */
console.log(
  "\nDETAILED SCORES"
);

console.table(
  normalized.map(function (row) {
    return {
      Team:
        row.team,

      "W1-4 Rank":
        row.earlyRank,

      "W1-4 Score":
        row.earlyScore,

      "Full Rank":
        row.fullRank,

      "Full Score":
        row.fullScore,

      "W14-16 Rank":
        row.p1416Rank,

      "W14-16 Score":
        row.p1416Score,

      "W15-17 Rank":
        row.p1517Rank,

      "W15-17 Score":
        row.p1517Score,

      "W14-17 Rank":
        row.p1417Rank,

      "W14-17 Score":
        row.p1417Score,
    };
  })
);

/**
 * SPECIFIC VALIDATION
 * -------------------
 * Christian McCaffrey vs De'Von Achane.
 */
const sf =
  normalized.find(
    function (row) {
      return (
        row.team ===
        "SF"
      );
    }
  );

const mia =
  normalized.find(
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
    "Could not locate both SF and MIA in the completed schedule board."
  );
}

console.log(
  "\nMcCAFFREY vs ACHANE CHECK"
);

console.table([
  {
    Player:
      "Christian McCaffrey",

    Team:
      "SF",

    "W1-4":
      formatRank(
        sf._early
      ),

    Full:
      formatRank(
        sf._full
      ),

    "W14-16":
      formatRank(
        sf._p1416
      ),

    "W15-17":
      formatRank(
        sf._p1517
      ),

    "W14-17":
      formatRank(
        sf._p1417
      ),
  },

  {
    Player:
      "De'Von Achane",

    Team:
      "MIA",

    "W1-4":
      formatRank(
        mia._early
      ),

    Full:
      formatRank(
        mia._full
      ),

    "W14-16":
      formatRank(
        mia._p1416
      ),

    "W15-17":
      formatRank(
        mia._p1517
      ),

    "W14-17":
      formatRank(
        mia._p1417
      ),
  },
]);

console.log(
  "\nSchedule Intelligence board generated successfully.\n"
);
