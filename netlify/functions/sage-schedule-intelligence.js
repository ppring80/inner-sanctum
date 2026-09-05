// netlify/functions/sage-schedule-intelligence.js
//
// SAGE — SCHEDULE INTELLIGENCE V1
//
// PURPOSE
// -------
// Provide the reusable calculation layer for position-specific
// fantasy schedule strength.
//
// V1 begins with RB.
//
// IMPORTANT
// ---------
// This file is intentionally SEPARATE from:
//
//   draft-sage-synthesis.js
//   sage-recommend.js
//   weekly-sage-* final scoring
//
// Schedule Intelligence does NOT change an existing SAGE score,
// recommendation, recommendation order, ADP, Opportunity,
// Scarcity, Market, Context, or Weekly SAGE matchup score.
//
// It is an additive evidence layer.
//
// CORE IDEA
// ---------
//
// Historical opposing RB production
//             ↓
// Fantasy points allowed by defense
//             ↓
// Defense-vs-RB ranking
//             ↓
// Future weekly NFL schedule
//             ↓
// Team schedule strength
//             ↓
// Early / Season / Playoff outlook
//
// RANK DIRECTION
// --------------
// Defense-vs-position:
//
//   #1 = MOST fantasy-friendly defense
//        (allows the most fantasy points)
//
// Schedule:
//
//   #1 = EASIEST / MOST FAVORABLE schedule
//
// SCORING
// -------
//
// Standard:
//   rushing yard       0.10
//   rushing TD         6
//   receiving yard     0.10
//   receiving TD       6
//   reception          0
//
// Half-PPR:
//   Standard + 0.5 per reception
//
// PPR:
//   Standard + 1.0 per reception
//
// V1 does not include league-specific bonuses or fumbles.
//
// ═══════════════════════════════════════════════════════════════════════

const NFL_TEAMS = [
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
  "LV",
  "LAC",
  "LAR",
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
];

const DEFAULT_PLAYOFF_WEEKS = [
  14,
  15,
  16,
  17
];

function num(value) {
  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : 0;
}

function round(
  value,
  digits = 2
) {
  const n =
    Number(value);

  if (
    !Number.isFinite(n)
  ) {
    return null;
  }

  const factor =
    Math.pow(
      10,
      digits
    );

  return (
    Math.round(
      (
        n +
        Number.EPSILON
      ) *
      factor
    ) /
    factor
  );
}

function normalizeTeam(
  value
) {
  const raw =
    String(
      value || ""
    )
      .trim()
      .toUpperCase();

  const aliases = {
    JAC: "JAX",
    GBP: "GB",
    KAN: "KC",
    LVR: "LV",
    NEP: "NE",
    NOR: "NO",
    SFO: "SF",
    TBB: "TB",
    WAS: "WSH"
  };

  return (
    aliases[raw] ||
    raw
  );
}

function normalizeScoring(
  value
) {
  const normalized =
    String(
      value || ""
    )
      .trim()
      .toLowerCase()
      .replace(
        /[_\s]+/g,
        "-"
      );

  if (
    [
      "ppr",
      "full-ppr",
      "fullppr"
    ].includes(
      normalized
    )
  ) {
    return "ppr";
  }

  if (
    [
      "half",
      "half-ppr",
      "halfppr",
      "0.5-ppr",
      ".5-ppr"
    ].includes(
      normalized
    )
  ) {
    return "halfPPR";
  }

  return "standard";
}

function statBlock(
  game,
  ...names
) {
  if (
    !game ||
    typeof game !==
      "object"
  ) {
    return {};
  }

  for (
    const name of
    names
  ) {
    if (
      game[name] &&
      typeof game[name] ===
        "object"
    ) {
      return game[name];
    }
  }

  return {};
}

function extractRbStats(
  game
) {
  const rushing =
    statBlock(
      game,
      "Rushing",
      "rushing"
    );

  const receiving =
    statBlock(
      game,
      "Receiving",
      "receiving"
    );

  return {
    rushing: {
      carries:
        num(
          rushing.carries ??
          rushing.rushAttempts ??
          rushing.attempts
        ),

      yards:
        num(
          rushing.rushYds ??
          rushing.rushYards ??
          rushing.rushingYards ??
          rushing.yards
        ),

      touchdowns:
        num(
          rushing.rushTD ??
          rushing.rushTouchdowns ??
          rushing.rushingTD ??
          rushing.touchdowns
        )
    },

    receiving: {
      targets:
        num(
          receiving.targets ??
          receiving.recTargets
        ),

      receptions:
        num(
          receiving.receptions ??
          receiving.rec ??
          receiving.catches
        ),

      yards:
        num(
          receiving.recYds ??
          receiving.receivingYards ??
          receiving.yards
        ),

      touchdowns:
        num(
          receiving.recTD ??
          receiving.receivingTD ??
          receiving.touchdowns
        )
    }
  };
}

function scoreRbGame(
  game,
  scoring
) {
  const format =
    normalizeScoring(
      scoring
    );

  const stats =
    extractRbStats(
      game
    );

  const base =
    (
      stats.rushing.yards *
        0.10
    ) +
    (
      stats.rushing.touchdowns *
        6
    ) +
    (
      stats.receiving.yards *
        0.10
    ) +
    (
      stats.receiving.touchdowns *
        6
    );

  let receptionPoints =
    0;

  if (
    format ===
      "halfPPR"
  ) {
    receptionPoints =
      stats.receiving.receptions *
      0.5;
  }

  if (
    format ===
      "ppr"
  ) {
    receptionPoints =
      stats.receiving.receptions;
  }

  return round(
    base +
    receptionPoints,
    2
  );
}

/*
  Normalize one historical player-game record into the minimal
  evidence needed by the defensive aggregation.

  Expected schedule context:

    gameID
    opponent / defense
    week

  The caller may provide the defense directly after joining
  player-game data to weekly-sage-schedule.
*/
function normalizeHistoricalRbGame(
  record,
  scoring
) {
  if (
    !record ||
    typeof record !==
      "object"
  ) {
    return null;
  }

  const gameID =
    String(
      record.gameID ||
      ""
    ).trim();

  const defense =
    normalizeTeam(
      record.defense ||
      record.opponent ||
      record.opponentTeam
    );

  const week =
    Number(
      record.week ??
      record.sageWeek ??
      record.gameWeek
    );

  if (
    !gameID ||
    !defense
  ) {
    return null;
  }

  return {
    gameID,

    week:
      Number.isInteger(
        week
      )
        ? week
        : null,

    defense,

    fantasyPoints:
      scoreRbGame(
        record,
        scoring
      )
  };
}

/*
  DEFENSE AGGREGATION
  -------------------

  Critical methodology:

  First SUM every opposing RB's fantasy production within a game.

  THEN average those TEAM-RB game totals across games.

  This prevents a defense from being penalized merely because the
  opponent used three RBs instead of one.
*/
function buildDefenseRbRatings({
  playerGames,
  scoring
}) {
  const format =
    normalizeScoring(
      scoring
    );

  const rows =
    Array.isArray(
      playerGames
    )
      ? playerGames
      : [];

  const byDefenseGame =
    new Map();

  for (
    const raw of
    rows
  ) {
    const record =
      normalizeHistoricalRbGame(
        raw,
        format
      );

    if (
      !record
    ) {
      continue;
    }

    const key =
      `${record.defense}|${record.gameID}`;

    if (
      !byDefenseGame.has(
        key
      )
    ) {
      byDefenseGame.set(
        key,
        {
          defense:
            record.defense,

          gameID:
            record.gameID,

          week:
            record.week,

          fantasyPoints:
            0,

          rbRecords:
            0
        }
      );
    }

    const game =
      byDefenseGame.get(
        key
      );

    game.fantasyPoints +=
      num(
        record.fantasyPoints
      );

    game.rbRecords +=
      1;
  }

  const byDefense =
    new Map();

  for (
    const game of
    byDefenseGame.values()
  ) {
    if (
      !byDefense.has(
        game.defense
      )
    ) {
      byDefense.set(
        game.defense,
        {
          defense:
            game.defense,

          games: []
        }
      );
    }

    byDefense
      .get(
        game.defense
      )
      .games
      .push({
        gameID:
          game.gameID,

        week:
          game.week,

        fantasyPoints:
          round(
            game.fantasyPoints,
            2
          ),

        rbRecords:
          game.rbRecords
      });
  }

  const ratings =
    [];

  for (
    const team of
    NFL_TEAMS
  ) {
    const record =
      byDefense.get(
        team
      );

    const games =
      record
        ? record.games
        : [];

    const total =
      games.reduce(
        (
          sum,
          game
        ) =>
          sum +
          num(
            game.fantasyPoints
          ),
        0
      );

    const average =
      games.length > 0
        ? total /
          games.length
        : null;

    ratings.push({
      defense:
        team,

      scoring:
        format,

      gamesSampled:
        games.length,

      fantasyPointsAllowed:
        average === null
          ? null
          : round(
              average,
              2
            ),

      gameEvidence:
        games
          .slice()
          .sort(
            (
              a,
              b
            ) =>
              num(
                a.week
              ) -
              num(
                b.week
              )
          )
    });
  }

  /*
    Most fantasy points allowed = easiest defense = rank #1.
  */
  const ranked =
    ratings
      .filter(
        rating =>
          rating.fantasyPointsAllowed !==
            null
      )
      .sort(
        (
          a,
          b
        ) =>
          b.fantasyPointsAllowed -
          a.fantasyPointsAllowed
      );

  ranked.forEach(
    (
      rating,
      index
    ) => {
      rating.rank =
        index + 1;

      rating.outlook =
        outlookFromRank(
          rating.rank,
          ranked.length
        );
    }
  );

  const rankMap =
    new Map(
      ranked.map(
        rating => [
          rating.defense,
          rating
        ]
      )
    );

  return ratings
    .map(
      rating => {
        const rankedRating =
          rankMap.get(
            rating.defense
          );

        if (
          rankedRating
        ) {
          return rankedRating;
        }

        return {
          ...rating,

          rank:
            null,

          outlook:
            "Unrated"
        };
      }
    )
    .sort(
      (
        a,
        b
      ) => {
        if (
          a.rank === null &&
          b.rank === null
        ) {
          return a.defense.localeCompare(
            b.defense
          );
        }

        if (
          a.rank === null
        ) {
          return 1;
        }

        if (
          b.rank === null
        ) {
          return -1;
        }

        return (
          a.rank -
          b.rank
        );
      }
    );
}

function outlookFromRank(
  rank,
  populationSize = 32
) {
  const r =
    Number(rank);

  const size =
    Number(populationSize);

  if (
    !Number.isFinite(r) ||
    !Number.isFinite(size) ||
    r < 1 ||
    size < 1
  ) {
    return "Unrated";
  }

  const percentile =
    r /
    size;

  if (
    percentile <=
      0.3125
  ) {
    return "Favorable";
  }

  if (
    percentile <=
      0.6875
  ) {
    return "Neutral";
  }

  return "Difficult";
}

function buildDefenseRatingMap(
  defenseRatings
) {
  const map =
    new Map();

  for (
    const rating of
    (
      Array.isArray(
        defenseRatings
      )
        ? defenseRatings
        : []
    )
  ) {
    const defense =
      normalizeTeam(
        rating &&
        rating.defense
      );

    if (
      !defense
    ) {
      continue;
    }

    map.set(
      defense,
      rating
    );
  }

  return map;
}

function normalizeScheduleGame(
  game,
  fallbackWeek
) {
  if (
    !game ||
    typeof game !==
      "object"
  ) {
    return null;
  }

  const home =
    normalizeTeam(
      game.home
    );

  const away =
    normalizeTeam(
      game.away
    );

  const week =
    Number(
      game.week ??
      game.gameWeek ??
      fallbackWeek
    );

  if (
    !home ||
    !away ||
    !Number.isInteger(
      week
    )
  ) {
    return null;
  }

  return {
    gameID:
      game.gameID ||
      null,

    week,

    home,

    away,

    gameDate:
      game.gameDate ||
      null,

    gameTime:
      game.gameTime ||
      null
  };
}

/*
  Accept either:

    [
      { week: 1, home: "SF", away: "LAR" },
      ...
    ]

  OR weekly-sage-schedule shaped objects:

    [
      {
        week: 1,
        games: [...]
      },
      {
        week: 2,
        games: [...]
      }
    ]
*/
function flattenSchedule(
  schedule
) {
  const result =
    [];

  const source =
    Array.isArray(
      schedule
    )
      ? schedule
      : [];

  for (
    const item of
    source
  ) {
    if (
      item &&
      Array.isArray(
        item.games
      )
    ) {
      const fallbackWeek =
        Number(
          item.week
        );

      for (
        const game of
        item.games
      ) {
        const normalized =
          normalizeScheduleGame(
            game,
            fallbackWeek
          );

        if (
          normalized
        ) {
          result.push(
            normalized
          );
        }
      }

      continue;
    }

    const normalized =
      normalizeScheduleGame(
        item,
        null
      );

    if (
      normalized
    ) {
      result.push(
        normalized
      );
    }
  }

  return result.sort(
    (
      a,
      b
    ) =>
      a.week -
      b.week
  );
}

function buildWeeklyTeamSchedule({
  schedule,
  defenseRatings
}) {
  const games =
    flattenSchedule(
      schedule
    );

  const ratingMap =
    buildDefenseRatingMap(
      defenseRatings
    );

  const teams = {};

  for (
    const team of
    NFL_TEAMS
  ) {
    teams[team] = [];
  }

  for (
    const game of
    games
  ) {
    const homeOpponentRating =
      ratingMap.get(
        game.away
      ) ||
      null;

    const awayOpponentRating =
      ratingMap.get(
        game.home
      ) ||
      null;

    teams[
      game.home
    ].push({
      week:
        game.week,

      gameID:
        game.gameID,

      opponent:
        game.away,

      location:
        "home",

      gameDate:
        game.gameDate,

      gameTime:
        game.gameTime,

      opponentDefenseRank:
        homeOpponentRating
          ? homeOpponentRating.rank
          : null,

      opponentFantasyPointsAllowed:
        homeOpponentRating
          ? homeOpponentRating
              .fantasyPointsAllowed
          : null,

      outlook:
        homeOpponentRating
          ? homeOpponentRating.outlook
          : "Unrated"
    });

    teams[
      game.away
    ].push({
      week:
        game.week,

      gameID:
        game.gameID,

      opponent:
        game.home,

      location:
        "away",

      gameDate:
        game.gameDate,

      gameTime:
        game.gameTime,

      opponentDefenseRank:
        awayOpponentRating
          ? awayOpponentRating.rank
          : null,

      opponentFantasyPointsAllowed:
        awayOpponentRating
          ? awayOpponentRating
              .fantasyPointsAllowed
          : null,

      outlook:
        awayOpponentRating
          ? awayOpponentRating.outlook
          : "Unrated"
    });
  }

  for (
    const team of
    NFL_TEAMS
  ) {
    teams[team].sort(
      (
        a,
        b
      ) =>
        a.week -
        b.week
    );
  }

  return teams;
}

function normalizeWeeks(
  weeks
) {
  return (
    Array.isArray(
      weeks
    )
      ? weeks
      : []
  )
    .map(
      Number
    )
    .filter(
      week =>
        Number.isInteger(
          week
        ) &&
        week >= 1 &&
        week <= 18
    )
    .filter(
      (
        week,
        index,
        array
      ) =>
        array.indexOf(
          week
        ) ===
        index
    )
    .sort(
      (
        a,
        b
      ) =>
        a - b
    );
}

function aggregateWindow(
  weekly,
  weeks
) {
  const requestedWeeks =
    normalizeWeeks(
      weeks
    );

  const weekSet =
    new Set(
      requestedWeeks
    );

  const included =
    (
      Array.isArray(
        weekly
      )
        ? weekly
        : []
    )
      .filter(
        game =>
          weekSet.has(
            Number(
              game.week
            )
          )
      )
      .filter(
        game =>
          Number.isFinite(
            Number(
              game
                .opponentFantasyPointsAllowed
            )
          )
      );

  /*
    Bye weeks naturally do not appear in weekly schedule rows.

    They are therefore EXCLUDED from the average rather than
    treated as zero-strength matchups.
  */
  const total =
    included.reduce(
      (
        sum,
        game
      ) =>
        sum +
        num(
          game
            .opponentFantasyPointsAllowed
        ),
      0
    );

  const average =
    included.length > 0
      ? total /
        included.length
      : null;

  return {
    requestedWeeks,

    gamesIncluded:
      included.length,

    byeOrMissingWeeks:
      requestedWeeks.filter(
        week =>
          !included.some(
            game =>
              Number(
                game.week
              ) ===
              week
          )
      ),

    averageOpponentFantasyPointsAllowed:
      average === null
        ? null
        : round(
            average,
            2
          )
  };
}

function rankScheduleWindow(
  teamRecords,
  key
) {
  const available =
    teamRecords
      .filter(
        record =>
          record[key] &&
          Number.isFinite(
            Number(
              record[key]
                .averageOpponentFantasyPointsAllowed
            )
          )
      )
      .sort(
        (
          a,
          b
        ) =>
          b[key]
            .averageOpponentFantasyPointsAllowed -
          a[key]
            .averageOpponentFantasyPointsAllowed
      );

  available.forEach(
    (
      record,
      index
    ) => {
      record[key].rank =
        index + 1;

      record[key].outlook =
        outlookFromRank(
          index + 1,
          available.length
        );
    }
  );
}

function buildLeagueScheduleIntelligence({
  schedule,
  defenseRatings,
  scoring,
  earlyWeeks = [
    1,
    2,
    3,
    4
  ],
  seasonWeeks = [
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
  ],
  playoffWeeks =
    DEFAULT_PLAYOFF_WEEKS
}) {
  const format =
    normalizeScoring(
      scoring
    );

  const weeklyByTeam =
    buildWeeklyTeamSchedule({
      schedule,
      defenseRatings
    });

  const teams =
    NFL_TEAMS.map(
      team => ({
        team,

        scoring:
          format,

        weekly:
          weeklyByTeam[
            team
          ] || [],

        earlySeason:
          aggregateWindow(
            weeklyByTeam[
              team
            ],
            earlyWeeks
          ),

        fullSeason:
          aggregateWindow(
            weeklyByTeam[
              team
            ],
            seasonWeeks
          ),

        fantasyPlayoffs:
          aggregateWindow(
            weeklyByTeam[
              team
            ],
            playoffWeeks
          )
      })
    );

  rankScheduleWindow(
    teams,
    "earlySeason"
  );

  rankScheduleWindow(
    teams,
    "fullSeason"
  );

  rankScheduleWindow(
    teams,
    "fantasyPlayoffs"
  );

  return {
    evidenceType:
      "sage-schedule-intelligence",

    schemaVersion:
      1,

    position:
      "RB",

    scoring:
      format,

    methodology: {
      defenseMetric:
        "Average opposing RB fantasy points allowed per game.",

      gameAggregation:
        "All opposing RB fantasy production is summed within each NFL game before calculating the defense's per-game average.",

      defenseRankDirection:
        "#1 allows the most RB fantasy points and is the most favorable defense to face.",

      scheduleRankDirection:
        "#1 has the most favorable average opponent profile.",

      byeHandling:
        "Bye weeks are excluded from schedule averages rather than scored as zero.",

      scoringFormatAware:
        true
    },

    windows: {
      earlySeason:
        normalizeWeeks(
          earlyWeeks
        ),

      fullSeason:
        normalizeWeeks(
          seasonWeeks
        ),

      fantasyPlayoffs:
        normalizeWeeks(
          playoffWeeks
        )
    },

    teams
  };
}

function buildScheduleInsight(
  record
) {
  if (
    !record ||
    typeof record !==
      "object"
  ) {
    return null;
  }

  const early =
    record.earlySeason ||
    {};

  const playoffs =
    record.fantasyPlayoffs ||
    {};

  const earlyText =
    early.outlook
      ? String(
          early.outlook
        ).toLowerCase()
      : "unrated";

  const playoffText =
    playoffs.outlook
      ? String(
          playoffs.outlook
        ).toLowerCase()
      : "unrated";

  if (
    earlyText ===
      "favorable" &&
    playoffText ===
      "difficult"
  ) {
    return "Favorable opening schedule, but a more difficult fantasy-playoff outlook.";
  }

  if (
    earlyText ===
      "difficult" &&
    playoffText ===
      "favorable"
  ) {
    return "Difficult opening schedule, with a more favorable fantasy-playoff outlook.";
  }

  if (
    earlyText ===
      "favorable" &&
    playoffText ===
      "favorable"
  ) {
    return "Favorable schedule profile both early and during the fantasy-playoff window.";
  }

  if (
    earlyText ===
      "difficult" &&
    playoffText ===
      "difficult"
  ) {
    return "Difficult schedule profile both early and during the fantasy-playoff window.";
  }

  return "Mostly neutral schedule profile with no strong early-versus-playoff split.";
}

module.exports = {
  NFL_TEAMS,
  DEFAULT_PLAYOFF_WEEKS,

  normalizeTeam,
  normalizeScoring,

  extractRbStats,
  scoreRbGame,

  normalizeHistoricalRbGame,
  buildDefenseRbRatings,

  outlookFromRank,

  flattenSchedule,
  buildWeeklyTeamSchedule,

  normalizeWeeks,
  aggregateWindow,

  buildLeagueScheduleIntelligence,
  buildScheduleInsight
};
