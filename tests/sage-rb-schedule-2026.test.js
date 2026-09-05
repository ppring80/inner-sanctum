// tests/sage-rb-schedule-2026.test.js
//
// End-to-end preseason RB Schedule Intelligence validation using:
//   1) frozen 2026 NFL regular-season schedule,
//   2) current Draft Command Center DEF market ADP board,
//   3) sage-rb-defense-difficulty.js,
//   4) sage-rb-schedule-preseason.js.
//
// ZERO network calls. ZERO Tank01 calls.

const assert = require("assert");

const {
  NFL_TEAMS,
  normalizeTeam,
  validateCompleteRegularSeason,
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
  SEASON,
  SEASON_TYPE,
  SOURCE,
  WEEK_GAMES,
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

function byTeam(result, team) {
  const normalized =
    normalizeTeam(team);

  return result.teams.find(
    (row) =>
      row.team === normalized
  );
}

(function testFrozenScheduleMetadata() {
  assert.strictEqual(
    SEASON,
    2026
  );

  assert.strictEqual(
    SEASON_TYPE,
    "REG"
  );

  assert.strictEqual(
    SOURCE.provider,
    "nflverse / nfldata"
  );
})();

(function test272Games() {
  assert.strictEqual(
    GAMES.length,
    272
  );
})();

(function testWeeks1Through18Present() {
  const weeks = [
    ...new Set(
      GAMES.map(
        (game) =>
          game.week
      )
    )
  ];

  assert.deepStrictEqual(
    weeks,
    Array.from(
      {
        length: 18
      },
      (_, index) =>
        index + 1
    )
  );
})();

(function testEveryTeamHas17Games() {
  const counts =
    Object.fromEntries(
      NFL_TEAMS.map(
        (team) => [
          team,
          0
        ]
      )
    );

  for (
    const game of GAMES
  ) {
    counts[
      game.away
    ] += 1;

    counts[
      game.home
    ] += 1;
  }

  for (
    const team of NFL_TEAMS
  ) {
    assert.strictEqual(
      counts[team],
      17,
      `${team} should have 17 games`
    );
  }
})();

(function testNoTeamAppearsTwiceInSameWeek() {
  const seen =
    new Set();

  for (
    const game of GAMES
  ) {
    for (
      const team of [
        game.away,
        game.home
      ]
    ) {
      const key =
        `${game.week}:${team}`;

      assert.ok(
        !seen.has(key),
        `${team} appears twice in Week ${game.week}`
      );

      seen.add(key);
    }
  }
})();

(function testSchedulePassesProductionValidator() {
  assert.deepStrictEqual(
    validateCompleteRegularSeason(
      GAMES
    ),
    []
  );
})();

(function testWeek14IsExplicitlyRetained() {
  assert.ok(
    Array.isArray(
      WEEK_GAMES[14]
    )
  );

  assert.ok(
    WEEK_GAMES[14].length >
      0
  );

  assert.ok(
    GAMES.some(
      (game) =>
        game.week === 14
    )
  );
})();

(function testKnownSfAndMiamiScheduleAnchors() {
  const sf =
    GAMES
      .filter(
        (game) =>
          game.away === "SF" ||
          game.home === "SF"
      )
      .sort(
        (a, b) =>
          a.week - b.week
      );

  const mia =
    GAMES
      .filter(
        (game) =>
          game.away === "MIA" ||
          game.home === "MIA"
      )
      .sort(
        (a, b) =>
          a.week - b.week
      );

  assert.deepStrictEqual(
    sf
      .slice(0, 4)
      .map(
        (game) =>
          game.away === "SF"
            ? game.home
            : game.away
      ),
    [
      "LAR",
      "MIA",
      "ARI",
      "DEN"
    ]
  );

  assert.deepStrictEqual(
    mia
      .slice(0, 4)
      .map(
        (game) =>
          game.away === "MIA"
            ? game.home
            : game.away
      ),
    [
      "LV",
      "SF",
      "KC",
      "MIN"
    ]
  );
})();

(function testDefenseBoardBuildsFromCurrentMarket() {
  const defense =
    buildRbDefenseDifficulty(
      DEF_MARKET_2026
    );

  assert.strictEqual(
    defense.available,
    true
  );

  assert.strictEqual(
    defense.ratings.length,
    32
  );

  assert.strictEqual(
    defense.trustedForProduction,
    false
  );
})();

(function testFull2026ScheduleIntelligenceBuild() {
  const defense =
    buildRbDefenseDifficulty(
      DEF_MARKET_2026
    );

  assert.strictEqual(
    defense.available,
    true
  );

  const result =
    buildLeagueRbScheduleIntelligence(
      GAMES,
      defense
    );

  assert.strictEqual(
    result.available,
    true
  );

  assert.strictEqual(
    result.scheduleGames,
    272
  );

  assert.strictEqual(
    result.defenseRatings,
    32
  );

  assert.strictEqual(
    result.teams.length,
    32
  );

  assert.strictEqual(
    result.direction.scheduleRank,
    "1 = easiest/best RB schedule"
  );

  assert.strictEqual(
    result.direction.difficultyScore,
    "higher = harder RB matchup/schedule"
  );

  for (
    const team of result.teams
  ) {
    assert.strictEqual(
      team.weekly.length,
      17,
      `${team.team} weekly rows`
    );

    for (
      const key of [
        "earlySeason",
        "fullSeason",
        "playoffs14to16",
        "playoffs15to17",
        "playoffs14to17"
      ]
    ) {
      assert.ok(
        team.windows[key],
        `${team.team} missing ${key}`
      );

      assert.ok(
        Number.isFinite(
          team.windows[key]
            .averageDifficultyScore
        ),
        `${team.team} ${key} should have a finite score`
      );

      assert.ok(
        Number.isFinite(
          team.windows[key]
            .scheduleRank
        ),
        `${team.team} ${key} should have a rank`
      );
    }
  }
})();

(function testMcCaffreyAchaneHorizonBehavior() {
  const defense =
    buildRbDefenseDifficulty(
      DEF_MARKET_2026
    );

  const result =
    buildLeagueRbScheduleIntelligence(
      GAMES,
      defense
    );

  const sf =
    byTeam(
      result,
      "SF"
    );

  const mia =
    byTeam(
      result,
      "MIA"
    );

  assert.ok(
    sf &&
    mia
  );

  // Lower averageDifficultyScore = easier schedule.

  assert.ok(
    sf.windows
      .earlySeason
      .averageDifficultyScore <
      mia.windows
        .earlySeason
        .averageDifficultyScore,
    "SF should have the easier Weeks 1-4 RB schedule"
  );

  assert.ok(
    mia.windows
      .fullSeason
      .averageDifficultyScore <
      sf.windows
        .fullSeason
        .averageDifficultyScore,
    "MIA should have the slightly easier full-season RB schedule"
  );

  assert.ok(
    mia.windows
      .playoffs14to16
      .averageDifficultyScore <
      sf.windows
        .playoffs14to16
        .averageDifficultyScore,
    "MIA should have the easier Weeks 14-16 RB playoff schedule"
  );

  assert.ok(
    mia.windows
      .playoffs15to17
      .averageDifficultyScore <
      sf.windows
        .playoffs15to17
        .averageDifficultyScore,
    "MIA should have the easier Weeks 15-17 RB playoff schedule"
  );

  assert.ok(
    mia.windows
      .playoffs14to17
      .averageDifficultyScore <
      sf.windows
        .playoffs14to17
        .averageDifficultyScore,
    "MIA should have the easier Weeks 14-17 RB playoff schedule"
  );
})();

console.log(
  "sage-rb-schedule-2026.test.js: all tests passed"
);
