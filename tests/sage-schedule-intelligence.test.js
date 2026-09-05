// tests/sage-schedule-intelligence.test.js
//
// SAGE — SCHEDULE INTELLIGENCE V1 REGRESSION TESTS
//
// Tests:
// - Standard / Half-PPR / PPR scoring
// - RB committee game aggregation
// - defensive ranking direction
// - scoring-format sensitivity
// - bye-week handling
// - configurable fantasy playoff windows
// - schedule ranking direction
// - consumer insight generation
//
// ═══════════════════════════════════════════════════════════════════════

const assert =
  require("assert");

const {
  scoreRbGame,
  buildDefenseRbRatings,
  aggregateWindow,
  buildLeagueScheduleIntelligence,
  buildScheduleInsight
} =
  require(
    "../netlify/functions/sage-schedule-intelligence.js"
  );

let passed =
  0;

let failed =
  0;

const failures =
  [];

function test(
  name,
  fn
) {
  try {
    fn();

    passed += 1;

    console.log(
      `✓ ${name}`
    );
  } catch (error) {
    failed += 1;

    failures.push(
      `${name}: ${error.message}`
    );

    console.error(
      `✗ ${name}`
    );

    console.error(
      error
    );
  }
}

function approxEqual(
  actual,
  expected,
  tolerance = 0.001
) {
  assert.ok(
    Math.abs(
      actual -
      expected
    ) <= tolerance,

    `Expected ${actual} to be within ${tolerance} of ${expected}`
  );
}


// ═══════════════════════════════════════════════════════════════════════
// TEST 1
// Scoring formats
// ═══════════════════════════════════════════════════════════════════════

test(
  "RB scoring preserves Standard / Half-PPR / PPR reception differences",
  function () {
    const game = {
      Rushing: {
        carries: 15,
        rushYds: 80,
        rushTD: 1
      },

      Receiving: {
        targets: 6,
        receptions: 5,
        recYds: 40,
        recTD: 0
      }
    };

    const standard =
      scoreRbGame(
        game,
        "standard"
      );

    const half =
      scoreRbGame(
        game,
        "halfPPR"
      );

    const ppr =
      scoreRbGame(
        game,
        "ppr"
      );

    approxEqual(
      standard,
      18
    );

    approxEqual(
      half,
      20.5
    );

    approxEqual(
      ppr,
      23
    );
  }
);


// ═══════════════════════════════════════════════════════════════════════
// TEST 2
// RB committee aggregation
// ═══════════════════════════════════════════════════════════════════════

test(
  "Defense aggregation sums all opposing RBs within a game before averaging",
  function () {
    const playerGames = [
      {
        gameID: "game-1",
        defense: "BUF",
        week: 1,

        Rushing: {
          rushYds: 60,
          rushTD: 0
        },

        Receiving: {
          receptions: 2,
          recYds: 20,
          recTD: 0
        }
      },

      {
        gameID: "game-1",
        defense: "BUF",
        week: 1,

        Rushing: {
          rushYds: 40,
          rushTD: 1
        },

        Receiving: {
          receptions: 1,
          recYds: 10,
          recTD: 0
        }
      },

      {
        gameID: "game-2",
        defense: "BUF",
        week: 2,

        Rushing: {
          rushYds: 50,
          rushTD: 0
        },

        Receiving: {
          receptions: 2,
          recYds: 20,
          recTD: 0
        }
      }
    ];

    const ratings =
      buildDefenseRbRatings({
        playerGames,
        scoring: "standard"
      });

    const buffalo =
      ratings.find(
        item =>
          item.defense === "BUF"
      );

    assert.ok(
      buffalo
    );

    assert.strictEqual(
      buffalo.gamesSampled,
      2
    );

    /*
      Game 1:

        RB1
        60 rushing yards = 6
        20 receiving yards = 2
        Total = 8

        RB2
        40 rushing yards = 4
        rushing TD = 6
        10 receiving yards = 1
        Total = 11

        Team RB total = 19

      Game 2:

        50 rushing yards = 5
        20 receiving yards = 2

        Team RB total = 7

      Defense average:

        (19 + 7) / 2 = 13
    */

    approxEqual(
      buffalo.fantasyPointsAllowed,
      13
    );

    assert.strictEqual(
      buffalo.gameEvidence[0]
        .rbRecords,
      2
    );
  }
);


// ═══════════════════════════════════════════════════════════════════════
// TEST 3
// Defensive ranking direction
// ═══════════════════════════════════════════════════════════════════════

test(
  "Defense rank #1 is the defense allowing the most RB fantasy points",
  function () {
    const playerGames = [
      {
        gameID: "a",
        defense: "ARI",
        week: 1,

        Rushing: {
          rushYds: 200,
          rushTD: 2
        }
      },

      {
        gameID: "b",
        defense: "BUF",
        week: 1,

        Rushing: {
          rushYds: 50,
          rushTD: 0
        }
      },

      {
        gameID: "c",
        defense: "CAR",
        week: 1,

        Rushing: {
          rushYds: 100,
          rushTD: 0
        }
      }
    ];

    const ratings =
      buildDefenseRbRatings({
        playerGames,
        scoring: "standard"
      });

    const arizona =
      ratings.find(
        item =>
          item.defense === "ARI"
      );

    const buffalo =
      ratings.find(
        item =>
          item.defense === "BUF"
      );

    const carolina =
      ratings.find(
        item =>
          item.defense === "CAR"
      );

    assert.strictEqual(
      arizona.rank,
      1
    );

    assert.ok(
      carolina.rank <
      buffalo.rank
    );
  }
);


// ═══════════════════════════════════════════════════════════════════════
// TEST 4
// Scoring-format sensitivity
// ═══════════════════════════════════════════════════════════════════════

test(
  "Receiving-heavy defense can rank differently in PPR than Standard",
  function () {
    const games = [
      {
        gameID: "a1",
        defense: "ARI",
        week: 1,

        Rushing: {
          rushYds: 50,
          rushTD: 0
        },

        Receiving: {
          receptions: 10,
          recYds: 30,
          recTD: 0
        }
      },

      {
        gameID: "b1",
        defense: "BUF",
        week: 1,

        Rushing: {
          rushYds: 100,
          rushTD: 0
        },

        Receiving: {
          receptions: 1,
          recYds: 20,
          recTD: 0
        }
      }
    ];

    const standard =
      buildDefenseRbRatings({
        playerGames: games,
        scoring: "standard"
      });

    const ppr =
      buildDefenseRbRatings({
        playerGames: games,
        scoring: "ppr"
      });

    const ariStandard =
      standard.find(
        item =>
          item.defense === "ARI"
      );

    const bufStandard =
      standard.find(
        item =>
          item.defense === "BUF"
      );

    const ariPpr =
      ppr.find(
        item =>
          item.defense === "ARI"
      );

    const bufPpr =
      ppr.find(
        item =>
          item.defense === "BUF"
      );

    /*
      Standard:
      BUF allows more points.

      PPR:
      ARI allows more because of receptions.
    */

    assert.ok(
      bufStandard.rank <
      ariStandard.rank
    );

    assert.ok(
      ariPpr.rank <
      bufPpr.rank
    );
  }
);


// ═══════════════════════════════════════════════════════════════════════
// TEST 5
// Bye handling
// ═══════════════════════════════════════════════════════════════════════

test(
  "Bye weeks are excluded rather than counted as zero",
  function () {
    const weekly = [
      {
        week: 14,
        opponent: "BUF",
        opponentFantasyPointsAllowed: 20
      },

      /*
        Week 15 intentionally absent.

        That represents a bye.
      */

      {
        week: 16,
        opponent: "GB",
        opponentFantasyPointsAllowed: 10
      },

      {
        week: 17,
        opponent: "LAC",
        opponentFantasyPointsAllowed: 15
      }
    ];

    const result =
      aggregateWindow(
        weekly,
        [
          14,
          15,
          16,
          17
        ]
      );

    assert.strictEqual(
      result.gamesIncluded,
      3
    );

    assert.deepStrictEqual(
      result.byeOrMissingWeeks,
      [
        15
      ]
    );

    /*
      (20 + 10 + 15) / 3 = 15

      NOT:

      (20 + 0 + 10 + 15) / 4
    */

    approxEqual(
      result
        .averageOpponentFantasyPointsAllowed,
      15
    );
  }
);


// ═══════════════════════════════════════════════════════════════════════
// TEST 6
// Configurable fantasy playoff window
// ═══════════════════════════════════════════════════════════════════════

test(
  "Fantasy playoff window is configurable and Week 14 remains available",
  function () {
    const defenseRatings = [
      {
        defense: "BUF",
        fantasyPointsAllowed: 25,
        rank: 1,
        outlook: "Favorable"
      },

      {
        defense: "GB",
        fantasyPointsAllowed: 20,
        rank: 2,
        outlook: "Favorable"
      },

      {
        defense: "LAC",
        fantasyPointsAllowed: 15,
        rank: 3,
        outlook: "Neutral"
      },

      {
        defense: "NE",
        fantasyPointsAllowed: 10,
        rank: 4,
        outlook: "Difficult"
      }
    ];

    const schedule = [
      {
        week: 14,
        home: "MIA",
        away: "BUF"
      },

      {
        week: 15,
        home: "MIA",
        away: "GB"
      },

      {
        week: 16,
        home: "MIA",
        away: "LAC"
      },

      {
        week: 17,
        home: "MIA",
        away: "NE"
      }
    ];

    const weeks14to16 =
      buildLeagueScheduleIntelligence({
        schedule,
        defenseRatings,
        scoring: "ppr",

        playoffWeeks: [
          14,
          15,
          16
        ]
      });

    const weeks15to17 =
      buildLeagueScheduleIntelligence({
        schedule,
        defenseRatings,
        scoring: "ppr",

        playoffWeeks: [
          15,
          16,
          17
        ]
      });

    const mia1416 =
      weeks14to16
        .teams
        .find(
          team =>
            team.team === "MIA"
        );

    const mia1517 =
      weeks15to17
        .teams
        .find(
          team =>
            team.team === "MIA"
        );

    assert.deepStrictEqual(
      mia1416
        .fantasyPlayoffs
        .requestedWeeks,
      [
        14,
        15,
        16
      ]
    );

    assert.deepStrictEqual(
      mia1517
        .fantasyPlayoffs
        .requestedWeeks,
      [
        15,
        16,
        17
      ]
    );

    assert.ok(
      mia1416
        .fantasyPlayoffs
        .averageOpponentFantasyPointsAllowed >
      mia1517
        .fantasyPlayoffs
        .averageOpponentFantasyPointsAllowed
    );

    /*
      Most important regression:

      Week 14 still exists individually.
    */

    assert.strictEqual(
      mia1416
        .weekly
        .find(
          game =>
            game.week === 14
        )
        .opponent,
      "BUF"
    );
  }
);


// ═══════════════════════════════════════════════════════════════════════
// TEST 7
// Schedule ranking direction
// ═══════════════════════════════════════════════════════════════════════

test(
  "Schedule rank #1 is the most favorable schedule",
  function () {
    const defenseRatings = [
      {
        defense: "ARI",
        fantasyPointsAllowed: 30,
        rank: 1,
        outlook: "Favorable"
      },

      {
        defense: "BUF",
        fantasyPointsAllowed: 10,
        rank: 2,
        outlook: "Difficult"
      }
    ];

    const schedule = [
      {
        week: 1,
        home: "SF",
        away: "ARI"
      },

      {
        week: 1,
        home: "MIA",
        away: "BUF"
      }
    ];

    const result =
      buildLeagueScheduleIntelligence({
        schedule,
        defenseRatings,
        scoring: "standard",

        earlyWeeks: [
          1
        ],

        seasonWeeks: [
          1
        ],

        playoffWeeks: [
          1
        ]
      });

    const sf =
      result
        .teams
        .find(
          team =>
            team.team === "SF"
        );

    const mia =
      result
        .teams
        .find(
          team =>
            team.team === "MIA"
        );

    assert.strictEqual(
      sf.earlySeason.rank,
      1
    );

    assert.ok(
      sf
        .earlySeason
        .averageOpponentFantasyPointsAllowed >
      mia
        .earlySeason
        .averageOpponentFantasyPointsAllowed
    );
  }
);


// ═══════════════════════════════════════════════════════════════════════
// TEST 8
// Consumer-facing insight
// ═══════════════════════════════════════════════════════════════════════

test(
  "Consumer insight describes favorable early / difficult playoff split",
  function () {
    const insight =
      buildScheduleInsight({
        earlySeason: {
          outlook: "Favorable"
        },

        fantasyPlayoffs: {
          outlook: "Difficult"
        }
      });

    assert.strictEqual(
      insight,
      "Favorable opening schedule, but a more difficult fantasy-playoff outlook."
    );
  }
);


// ═══════════════════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════════════════

console.log("");
console.log(
  `Schedule Intelligence tests: ${passed} passed, ${failed} failed`
);

if (
  failures.length > 0
) {
  console.log("");

  failures.forEach(
    failure =>
      console.log(
        failure
      )
  );

  process.exitCode =
    1;
}
