// netlify/functions/sage-rb-schedule-preseason.js
//
// INNER SANCTUM — PRESEASON RB SCHEDULE INTELLIGENCE
//
// PURPOSE
// -------
// Convert a 32-team RB defensive-difficulty board plus a normalized NFL
// regular-season schedule into team-level RB Schedule Intelligence.
//
// IMPORTANT ARCHITECTURE RULES
// ----------------------------
// - Pure calculation only.
// - ZERO Tank01 calls.
// - ZERO network calls.
// - ZERO Netlify Blob reads/writes.
// - Does NOT modify Draft SAGE scoring.
// - Defense difficulty direction:
//       #1 defense = HARDEST RB matchup.
// - Schedule rank direction:
//       #1 schedule = EASIEST / BEST RB schedule.
// - Aggregation uses continuous opponent difficultyScore, NOT display rank.
// - Byes are ignored in averages.
// - Week 14 is preserved.
// - Playoff windows are configurable.
//
// EXPECTED DEFENSE INPUT
// ----------------------
// Either:
//   [
//     {
//       team: "DEN",
//       difficultyScore: 0.91,
//       difficultyRank: 1,
//       outlook: "Difficult"
//     },
//     ...
//   ]
//
// or the successful result from sage-rb-defense-difficulty.js:
//   {
//     available: true,
//     ratings: [ ... ]
//   }
//
// EXPECTED SCHEDULE INPUT
// -----------------------
// Flat games are preferred:
//   [
//     { week: 1, away: "SF", home: "LAR" },
//     ...
//   ]
//
// The normalizer also accepts common aliases such as awayTeam/homeTeam,
// awayAbv/homeAbv, and weekly objects with a games[] array.

const MODEL_VERSION =
  "rb-schedule-preseason-v1";

const NFL_TEAMS = Object.freeze([
  "ARI",
  "ATL",
  "BAL",
  "BUF",
  "CAR",
  "CHI",
  "CIN",
  "CLE",
  "DAL",
  "DEN",
  "DET",
  "GB",
  "HOU",
  "IND",
  "JAX",
  "KC",
  "LAC",
  "LAR",
  "LV",
  "MIA",
  "MIN",
  "NE",
  "NO",
  "NYG",
  "NYJ",
  "PHI",
  "PIT",
  "SEA",
  "SF",
  "TB",
  "TEN",
  "WSH"
]);

const TEAM_SET =
  new Set(
    NFL_TEAMS
  );

const TEAM_ALIASES = Object.freeze({
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
  JAC: "JAX",
  JAX: "JAX",
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
  WAS: "WSH",
  WSH: "WSH"
});

const DEFAULT_WINDOWS = Object.freeze({
  earlySeason: Object.freeze([
    1,
    2,
    3,
    4
  ]),

  fullSeason: Object.freeze([
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    8,
    9,
    10,
    11,
    12,
    13,
    14,
    15,
    16,
    17,
    18
  ]),

  playoffs14to16: Object.freeze([
    14,
    15,
    16
  ]),

  playoffs15to17: Object.freeze([
    15,
    16,
    17
  ]),

  playoffs14to17: Object.freeze([
    14,
    15,
    16,
    17
  ])
});

function normalizeTeam(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const raw =
    String(
      value
    )
      .trim()
      .toUpperCase();

  if (
    !raw
  ) {
    return null;
  }

  return (
    TEAM_ALIASES[
      raw
    ] ||
    raw
  );
}

function finiteNumber(
  value
) {
  const number =
    Number(
      value
    );

  return Number.isFinite(
    number
  )
    ? number
    : null;
}

function round(
  value,
  digits = 4
) {
  const number =
    finiteNumber(
      value
    );

  if (
    number === null
  ) {
    return null;
  }

  const factor =
    10 ** digits;

  return (
    Math.round(
      number * factor
    ) /
    factor
  );
}

function normalizeWeeks(
  weeks
) {
  const source =
    Array.isArray(
      weeks
    )
      ? weeks
      : [];

  return Array.from(
    new Set(
      source
        .map(
          finiteNumber
        )
        .filter(
          function (
            week
          ) {
            return (
              Number.isInteger(
                week
              ) &&
              week >= 1 &&
              week <= 18
            );
          }
        )
    )
  ).sort(
    function (
      a,
      b
    ) {
      return a - b;
    }
  );
}

function resolveWeek(
  game,
  inheritedWeek
) {
  const candidates = [
    game && game.week,
    game && game.weekNumber,
    game && game.weekNum,
    inheritedWeek
  ];

  for (
    const candidate of candidates
  ) {
    const week =
      finiteNumber(
        candidate
      );

    if (
      Number.isInteger(
        week
      ) &&
      week >= 1 &&
      week <= 18
    ) {
      return week;
    }
  }

  return null;
}

function firstTeam(
  game,
  keys
) {
  for (
    const key of keys
  ) {
    if (
      game &&
      game[key] !== null &&
      game[key] !== undefined &&
      String(
        game[key]
      ).trim()
    ) {
      return normalizeTeam(
        game[key]
      );
    }
  }

  return null;
}

function normalizeGame(
  game,
  inheritedWeek
) {
  if (
    !game ||
    typeof game !==
      "object"
  ) {
    return null;
  }

  const week =
    resolveWeek(
      game,
      inheritedWeek
    );

  const away =
    firstTeam(
      game,
      [
        "away",
        "awayTeam",
        "awayAbv",
        "awayTeamAbv",
        "awayTeamAbbreviation"
      ]
    );

  const home =
    firstTeam(
      game,
      [
        "home",
        "homeTeam",
        "homeAbv",
        "homeTeamAbv",
        "homeTeamAbbreviation"
      ]
    );

  if (
    week === null ||
    !away ||
    !home ||
    away === home ||
    !TEAM_SET.has(
      away
    ) ||
    !TEAM_SET.has(
      home
    )
  ) {
    return null;
  }

  return {
    week,
    away,
    home
  };
}

function flattenSchedule(
  schedule
) {
  const games = [];

  function visit(
    node,
    inheritedWeek = null
  ) {
    if (
      !node
    ) {
      return;
    }

    if (
      Array.isArray(
        node
      )
    ) {
      for (
        const child of node
      ) {
        visit(
          child,
          inheritedWeek
        );
      }

      return;
    }

    if (
      typeof node !==
        "object"
    ) {
      return;
    }

    const nodeWeek =
      resolveWeek(
        node,
        inheritedWeek
      );

    if (
      Array.isArray(
        node.games
      )
    ) {
      for (
        const game of node.games
      ) {
        visit(
          game,
          nodeWeek
        );
      }

      return;
    }

    if (
      Array.isArray(
        node.schedule
      )
    ) {
      visit(
        node.schedule,
        nodeWeek
      );

      return;
    }

    const normalized =
      normalizeGame(
        node,
        inheritedWeek
      );

    if (
      normalized
    ) {
      games.push(
        normalized
      );
    }
  }

  visit(
    schedule
  );

  const seen =
    new Set();

  return games
    .filter(
      function (
        game
      ) {
        const teams = [
          game.away,
          game.home
        ].sort();

        const key =
          `${game.week}:${teams[0]}:${teams[1]}`;

        if (
          seen.has(
            key
          )
        ) {
          return false;
        }

        seen.add(
          key
        );

        return true;
      }
    )
    .sort(
      function (
        a,
        b
      ) {
        return (
          a.week - b.week ||
          a.away.localeCompare(
            b.away
          ) ||
          a.home.localeCompare(
            b.home
          )
        );
      }
    );
}

function extractDefenseRatings(
  input
) {
  if (
    Array.isArray(
      input
    )
  ) {
    return input;
  }

  if (
    input &&
    Array.isArray(
      input.ratings
    )
  ) {
    return input.ratings;
  }

  return [];
}

function normalizeDefenseRatings(
  input
) {
  const ratings =
    extractDefenseRatings(
      input
    );

  const byTeam =
    new Map();

  for (
    const row of ratings
  ) {
    const team =
      normalizeTeam(
        row && row.team
      );

    const difficultyScore =
      finiteNumber(
        row &&
          row.difficultyScore
      );

    if (
      !team ||
      !TEAM_SET.has(
        team
      ) ||
      difficultyScore === null
    ) {
      continue;
    }

    const difficultyRank =
      finiteNumber(
        row &&
          row.difficultyRank
      );

    byTeam.set(
      team,
      {
        team,
        difficultyScore,
        difficultyRank,
        outlook:
          row &&
          row.outlook
            ? String(
                row.outlook
              )
            : null
      }
    );
  }

  return byTeam;
}

function validateDefenseRatings(
  ratingMap
) {
  const problems = [];

  if (
    !(ratingMap instanceof Map)
  ) {
    return [
      "Defense ratings did not normalize to a Map."
    ];
  }

  if (
    ratingMap.size !==
      NFL_TEAMS.length
  ) {
    problems.push(
      `Expected ${NFL_TEAMS.length} unique defense ratings, found ${ratingMap.size}.`
    );
  }

  for (
    const team of NFL_TEAMS
  ) {
    const rating =
      ratingMap.get(
        team
      );

    if (
      !rating
    ) {
      problems.push(
        `Missing defense rating for ${team}.`
      );

      continue;
    }

    if (
      finiteNumber(
        rating.difficultyScore
      ) === null
    ) {
      problems.push(
        `Defense rating for ${team} is missing difficultyScore.`
      );
    }
  }

  return problems;
}

function validateCompleteRegularSeason(
  games
) {
  const problems = [];

  if (
    !Array.isArray(
      games
    )
  ) {
    return [
      "Schedule is not an array."
    ];
  }

  if (
    games.length !==
      272
  ) {
    problems.push(
      `Expected 272 regular-season games, found ${games.length}.`
    );
  }

  const teamGameCounts =
    new Map(
      NFL_TEAMS.map(
        function (
          team
        ) {
          return [
            team,
            0
          ];
        }
      )
    );

  const teamWeeks =
    new Map(
      NFL_TEAMS.map(
        function (
          team
        ) {
          return [
            team,
            new Set()
          ];
        }
      )
    );

  for (
    const game of games
  ) {
    if (
      !game ||
      !TEAM_SET.has(
        game.away
      ) ||
      !TEAM_SET.has(
        game.home
      )
    ) {
      problems.push(
        "Schedule contains a game with an unknown team."
      );

      continue;
    }

    if (
      !Number.isInteger(
        game.week
      ) ||
      game.week < 1 ||
      game.week > 18
    ) {
      problems.push(
        "Schedule contains a game outside Weeks 1-18."
      );

      continue;
    }

    for (
      const team of [
        game.away,
        game.home
      ]
    ) {
      teamGameCounts.set(
        team,
        teamGameCounts.get(
          team
        ) + 1
      );

      const weeks =
        teamWeeks.get(
          team
        );

      if (
        weeks.has(
          game.week
        )
      ) {
        problems.push(
          `${team} appears more than once in Week ${game.week}.`
        );
      }

      weeks.add(
        game.week
      );
    }
  }

  for (
    const team of NFL_TEAMS
  ) {
    const count =
      teamGameCounts.get(
        team
      );

    if (
      count !== 17
    ) {
      problems.push(
        `${team} has ${count} regular-season games; expected 17.`
      );
    }
  }

  return Array.from(
    new Set(
      problems
    )
  );
}

function buildWeeklyTeamSchedule(
  games,
  ratingMap
) {
  const byTeam =
    new Map(
      NFL_TEAMS.map(
        function (
          team
        ) {
          return [
            team,
            []
          ];
        }
      )
    );

  for (
    const game of games
  ) {
    const awayOpponent =
      ratingMap.get(
        game.home
      );

    const homeOpponent =
      ratingMap.get(
        game.away
      );

    if (
      awayOpponent
    ) {
      byTeam.get(
        game.away
      ).push({
        week:
          game.week,
        opponent:
          game.home,
        location:
          "AWAY",
        opponentDifficultyScore:
          round(
            awayOpponent.difficultyScore,
            6
          ),
        opponentDifficultyRank:
          awayOpponent.difficultyRank,
        opponentOutlook:
          awayOpponent.outlook
      });
    }

    if (
      homeOpponent
    ) {
      byTeam.get(
        game.home
      ).push({
        week:
          game.week,
        opponent:
          game.away,
        location:
          "HOME",
        opponentDifficultyScore:
          round(
            homeOpponent.difficultyScore,
            6
          ),
        opponentDifficultyRank:
          homeOpponent.difficultyRank,
        opponentOutlook:
          homeOpponent.outlook
      });
    }
  }

  for (
    const team of NFL_TEAMS
  ) {
    byTeam.get(
      team
    ).sort(
      function (
        a,
        b
      ) {
        return a.week - b.week;
      }
    );
  }

  return byTeam;
}

function aggregateWindow(
  weeklyRows,
  weeks
) {
  const normalizedWeeks =
    normalizeWeeks(
      weeks
    );

  const weekSet =
    new Set(
      normalizedWeeks
    );

  const rows =
    Array.isArray(
      weeklyRows
    )
      ? weeklyRows.filter(
          function (
            row
          ) {
            return weekSet.has(
              finiteNumber(
                row && row.week
              )
            );
          }
        )
      : [];

  const scoredRows =
    rows.filter(
      function (
        row
      ) {
        return (
          finiteNumber(
            row &&
              row.opponentDifficultyScore
          ) !== null
        );
      }
    );

  const playedWeeks =
    new Set(
      rows.map(
        function (
          row
        ) {
          return row.week;
        }
      )
    );

  const byeWeeks =
    normalizedWeeks.filter(
      function (
        week
      ) {
        return !playedWeeks.has(
          week
        );
      }
    );

  if (
    !scoredRows.length
  ) {
    return {
      weeks:
        normalizedWeeks,
      games:
        0,
      byeWeeks,
      averageDifficultyScore:
        null,
      hardestOpponent:
        null,
      easiestOpponent:
        null
    };
  }

  const total =
    scoredRows.reduce(
      function (
        sum,
        row
      ) {
        return (
          sum +
          row.opponentDifficultyScore
        );
      },
      0
    );

  const hardestOpponent =
    scoredRows
      .slice()
      .sort(
        function (
          a,
          b
        ) {
          return (
            b.opponentDifficultyScore -
              a.opponentDifficultyScore ||
            a.week - b.week ||
            a.opponent.localeCompare(
              b.opponent
            )
          );
        }
      )[0];

  const easiestOpponent =
    scoredRows
      .slice()
      .sort(
        function (
          a,
          b
        ) {
          return (
            a.opponentDifficultyScore -
              b.opponentDifficultyScore ||
            a.week - b.week ||
            a.opponent.localeCompare(
              b.opponent
            )
          );
        }
      )[0];

  return {
    weeks:
      normalizedWeeks,
    games:
      scoredRows.length,
    byeWeeks,
    averageDifficultyScore:
      round(
        total /
          scoredRows.length,
        6
      ),
    hardestOpponent: {
      week:
        hardestOpponent.week,
      opponent:
        hardestOpponent.opponent,
      difficultyScore:
        hardestOpponent.opponentDifficultyScore,
      difficultyRank:
        hardestOpponent.opponentDifficultyRank
    },
    easiestOpponent: {
      week:
        easiestOpponent.week,
      opponent:
        easiestOpponent.opponent,
      difficultyScore:
        easiestOpponent.opponentDifficultyScore,
      difficultyRank:
        easiestOpponent.opponentDifficultyRank
    }
  };
}

function scheduleOutlookFromRank(
  rank
) {
  const numericRank =
    finiteNumber(
      rank
    );

  if (
    numericRank === null
  ) {
    return null;
  }

  if (
    numericRank <= 10
  ) {
    return "Favorable";
  }

  if (
    numericRank <= 22
  ) {
    return "Neutral";
  }

  return "Difficult";
}

function assignScheduleRanks(
  rows
) {
  const valid =
    rows
      .filter(
        function (
          row
        ) {
          return (
            finiteNumber(
              row.averageDifficultyScore
            ) !== null
          );
        }
      )
      .sort(
        function (
          a,
          b
        ) {
          return (
            a.averageDifficultyScore -
              b.averageDifficultyScore ||
            a.team.localeCompare(
              b.team
            )
          );
        }
      );

  let priorScore =
    null;

  let priorRank =
    null;

  for (
    let index = 0;
    index < valid.length;
    index += 1
  ) {
    const row =
      valid[index];

    const score =
      row.averageDifficultyScore;

    let rank;

    if (
      priorScore !== null &&
      score === priorScore
    ) {
      rank =
        priorRank;
    } else {
      rank =
        index + 1;

      priorRank =
        rank;

      priorScore =
        score;
    }

    row.scheduleRank =
      rank;

    row.scheduleOrder =
      index + 1;
  }

  const countsByRank =
    new Map();

  for (
    const row of valid
  ) {
    countsByRank.set(
      row.scheduleRank,
      (
        countsByRank.get(
          row.scheduleRank
        ) || 0
      ) + 1
    );
  }

  for (
    const row of valid
  ) {
    const tied =
      countsByRank.get(
        row.scheduleRank
      ) > 1;

    row.scheduleRankLabel =
      tied
        ? `T-${row.scheduleRank}`
        : String(
            row.scheduleRank
          );

    row.outlook =
      scheduleOutlookFromRank(
        row.scheduleRank
      );
  }

  return valid;
}

function normalizeWindows(
  customWindows
) {
  const output = {};

  const source =
    customWindows &&
    typeof customWindows ===
      "object"
      ? customWindows
      : DEFAULT_WINDOWS;

  for (
    const [
      key,
      weeks
    ] of Object.entries(
      source
    )
  ) {
    const normalized =
      normalizeWeeks(
        weeks
      );

    if (
      normalized.length
    ) {
      output[key] =
        normalized;
    }
  }

  return output;
}

function buildScheduleInsight(
  windows
) {
  if (
    !windows ||
    typeof windows !==
      "object"
  ) {
    return null;
  }

  const early =
    windows.earlySeason ||
    null;

  const playoffs =
    windows.playoffs15to17 ||
    windows.playoffs14to16 ||
    windows.playoffs14to17 ||
    null;

  if (
    !early &&
    !playoffs
  ) {
    return null;
  }

  if (
    early &&
    playoffs
  ) {
    if (
      early.outlook ===
        playoffs.outlook
    ) {
      return `${early.outlook} opening-month and fantasy-playoff RB schedule.`;
    }

    return `${early.outlook} opening-month schedule; ${playoffs.outlook.toLowerCase()} fantasy-playoff path.`;
  }

  if (
    early
  ) {
    return `${early.outlook} opening-month RB schedule.`;
  }

  return `${playoffs.outlook} fantasy-playoff RB schedule.`;
}

function buildLeagueRbScheduleIntelligence(
  schedule,
  defenseDifficulty,
  options = {}
) {
  const games =
    flattenSchedule(
      schedule
    );

  const ratingMap =
    normalizeDefenseRatings(
      defenseDifficulty
    );

  const problems = [];

  if (
    options.requireCompleteRatings !==
      false
  ) {
    problems.push(
      ...validateDefenseRatings(
        ratingMap
      )
    );
  }

  if (
    options.requireCompleteSchedule !==
      false
  ) {
    problems.push(
      ...validateCompleteRegularSeason(
        games
      )
    );
  }

  if (
    problems.length
  ) {
    return {
      evidenceType:
        "sage-rb-schedule-intelligence",

      modelVersion:
        MODEL_VERSION,

      available:
        false,

      trustedForProduction:
        false,

      status:
        "invalid-input",

      reason:
        "RB Schedule Intelligence input failed validation.",

      problems:
        Array.from(
          new Set(
            problems
          )
        ),

      direction: {
        defenseDifficultyRank:
          "1 = hardest RB defense",

        scheduleRank:
          "1 = easiest/best RB schedule",

        difficultyScore:
          "higher = harder RB matchup/schedule"
      },

      teams: []
    };
  }

  const windows =
    normalizeWindows(
      options.windows
    );

  const weeklyByTeam =
    buildWeeklyTeamSchedule(
      games,
      ratingMap
    );

  const teamMap =
    new Map();

  for (
    const team of NFL_TEAMS
  ) {
    const weekly =
      weeklyByTeam.get(
        team
      ) || [];

    const teamWindows = {};

    for (
      const [
        key,
        weeks
      ] of Object.entries(
        windows
      )
    ) {
      teamWindows[key] =
        aggregateWindow(
          weekly,
          weeks
        );
    }

    teamMap.set(
      team,
      {
        team,
        weekly,
        windows:
          teamWindows
      }
    );
  }

  for (
    const windowKey of Object.keys(
      windows
    )
  ) {
    const rankRows =
      NFL_TEAMS.map(
        function (
          team
        ) {
          return {
            team,

            averageDifficultyScore:
              teamMap.get(
                team
              ).windows[
                windowKey
              ].averageDifficultyScore
          };
        }
      );

    assignScheduleRanks(
      rankRows
    );

    const rankByTeam =
      new Map(
        rankRows.map(
          function (
            row
          ) {
            return [
              row.team,
              row
            ];
          }
        )
      );

    for (
      const team of NFL_TEAMS
    ) {
      const ranked =
        rankByTeam.get(
          team
        );

      const target =
        teamMap.get(
          team
        ).windows[
          windowKey
        ];

      if (
        ranked
      ) {
        target.scheduleRank =
          ranked.scheduleRank;

        target.scheduleRankLabel =
          ranked.scheduleRankLabel;

        target.scheduleOrder =
          ranked.scheduleOrder;

        target.outlook =
          ranked.outlook;
      } else {
        target.scheduleRank =
          null;

        target.scheduleRankLabel =
          null;

        target.scheduleOrder =
          null;

        target.outlook =
          null;
      }
    }
  }

  const teams =
    NFL_TEAMS.map(
      function (
        team
      ) {
        const row =
          teamMap.get(
            team
          );

        return {
          team:
            row.team,

          weekly:
            row.weekly,

          windows:
            row.windows,

          insight:
            buildScheduleInsight(
              row.windows
            )
        };
      }
    );

  return {
    evidenceType:
      "sage-rb-schedule-intelligence",

    modelVersion:
      MODEL_VERSION,

    available:
      true,

    trustedForProduction:
      false,

    status:
      "preseason-v1-validation",

    scheduleGames:
      games.length,

    defenseRatings:
      ratingMap.size,

    direction: {
      defenseDifficultyRank:
        "1 = hardest RB defense",

      scheduleRank:
        "1 = easiest/best RB schedule",

      difficultyScore:
        "higher = harder RB matchup/schedule"
    },

    windows,

    teams
  };
}

module.exports = {
  MODEL_VERSION,
  NFL_TEAMS,
  DEFAULT_WINDOWS,
  normalizeTeam,
  finiteNumber,
  round,
  normalizeWeeks,
  normalizeGame,
  flattenSchedule,
  extractDefenseRatings,
  normalizeDefenseRatings,
  validateDefenseRatings,
  validateCompleteRegularSeason,
  buildWeeklyTeamSchedule,
  aggregateWindow,
  scheduleOutlookFromRank,
  assignScheduleRanks,
  normalizeWindows,
  buildScheduleInsight,
  buildLeagueRbScheduleIntelligence
};
