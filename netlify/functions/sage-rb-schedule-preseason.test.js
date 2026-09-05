// tests/sage-rb-schedule-preseason.test.js

const assert =
  require(
    "assert"
  );

const {
  NFL_TEAMS,
  normalizeTeam,
  flattenSchedule,
  aggregateWindow,
  assignScheduleRanks,
  buildLeagueRbScheduleIntelligence
} = require(
  "../netlify/functions/sage-rb-schedule-preseason.js"
);

function makeRatings() {
  return NFL_TEAMS.map(
    function (
      team,
      index
    ) {
      return {
        team,

        difficultyScore:
          Number(
            (
              1 -
              index /
                31
            ).toFixed(
              6
            )
          ),

        difficultyRank:
          index + 1,

        outlook:
          index < 10
            ? "Difficult"
            : index < 22
              ? "Neutral"
              : "Favorable"
      };
    }
  );
}

(function testAliases() {
  assert.strictEqual(
    normalizeTeam(
      "WAS"
    ),
    "WSH"
  );

  assert.strictEqual(
    normalizeTeam(
      "SFO"
    ),
    "SF"
  );

  assert.strictEqual(
    normalizeTeam(
      "JAC"
    ),
    "JAX"
  );
})();

(function testScheduleFlattening() {
  const flat =
    flattenSchedule([
      {
        week: 1,

        games: [
          {
            awayTeam:
              "SFO",

            homeTeam:
              "LAR"
          }
        ]
      },

      {
        weekNumber: 2,

        awayAbv:
          "WAS",

        homeAbv:
          "JAC"
      }
    ]);

  assert.deepStrictEqual(
    flat,
    [
      {
        week: 1,
        away: "SF",
        home: "LAR"
      },

      {
        week: 2,
        away: "WSH",
        home: "JAX"
      }
    ]
  );
})();

(function testHarderOpponentRaisesDifficulty() {
  const easy =
    aggregateWindow(
      [
        {
          week: 1,
          opponent:
            "A",
          opponentDifficultyScore:
            0.2
        },

        {
          week: 2,
          opponent:
            "B",
          opponentDifficultyScore:
            0.4
        }
      ],
      [
        1,
        2
      ]
    );

  const hard =
    aggregateWindow(
      [
        {
          week: 1,
          opponent:
            "A",
          opponentDifficultyScore:
            0.8
        },

        {
          week: 2,
          opponent:
            "B",
          opponentDifficultyScore:
            0.9
        }
      ],
      [
        1,
        2
      ]
    );

  assert.ok(
    hard.averageDifficultyScore >
      easy.averageDifficultyScore
  );
})();

(function testByeIgnored() {
  const result =
    aggregateWindow(
      [
        {
          week: 1,
          opponent:
            "A",
          opponentDifficultyScore:
            0.4
        },

        {
          week: 3,
          opponent:
            "B",
          opponentDifficultyScore:
            0.8
        }
      ],
      [
        1,
        2,
        3
      ]
    );

  assert.strictEqual(
    result.games,
    2
  );

  assert.deepStrictEqual(
    result.byeWeeks,
    [
      2
    ]
  );

  assert.strictEqual(
    result.averageDifficultyScore,
    0.6
  );
})();

(function testWeek14PreservedAndPlayoffWindowsDiffer() {
  const rows = [
    {
      week: 14,
      opponent:
        "A",
      opponentDifficultyScore:
        0.1
    },

    {
      week: 15,
      opponent:
        "B",
      opponentDifficultyScore:
        0.5
    },

    {
      week: 16,
      opponent:
        "C",
      opponentDifficultyScore:
        0.5
    },

    {
      week: 17,
      opponent:
        "D",
      opponentDifficultyScore:
        0.9
    }
  ];

  const weeks14to16 =
    aggregateWindow(
      rows,
      [
        14,
        15,
        16
      ]
    );

  const weeks15to17 =
    aggregateWindow(
      rows,
      [
        15,
        16,
        17
      ]
    );

  assert.deepStrictEqual(
    weeks14to16.weeks,
    [
      14,
      15,
      16
    ]
  );

  assert.notStrictEqual(
    weeks14to16.averageDifficultyScore,
    weeks15to17.averageDifficultyScore
  );

  assert.ok(
    weeks14to16.averageDifficultyScore <
      weeks15to17.averageDifficultyScore
  );
})();

(function testScheduleRankDirection() {
  const rows = [
    {
      team:
        "AAA",

      averageDifficultyScore:
        0.2
    },

    {
      team:
        "BBB",

      averageDifficultyScore:
        0.8
    },

    {
      team:
        "CCC",

      averageDifficultyScore:
        0.5
    }
  ];

  assignScheduleRanks(
    rows
  );

  const byTeam =
    Object.fromEntries(
      rows.map(
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

  assert.strictEqual(
    byTeam.AAA.scheduleRank,
    1
  );

  assert.strictEqual(
    byTeam.BBB.scheduleRank,
    3
  );
})();

(function testTieLabels() {
  const rows = [
    {
      team:
        "AAA",

      averageDifficultyScore:
        0.2
    },

    {
      team:
        "BBB",

      averageDifficultyScore:
        0.2
    },

    {
      team:
        "CCC",

      averageDifficultyScore:
        0.4
    }
  ];

  assignScheduleRanks(
    rows
  );

  const byTeam =
    Object.fromEntries(
      rows.map(
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

  assert.strictEqual(
    byTeam.AAA.scheduleRankLabel,
    "T-1"
  );

  assert.strictEqual(
    byTeam.BBB.scheduleRankLabel,
    "T-1"
  );

  assert.strictEqual(
    byTeam.CCC.scheduleRank,
    3
  );
})();

(function testIncompleteRatingsFailClosed() {
  const ratings =
    makeRatings()
      .slice(
        0,
        31
      );

  const result =
    buildLeagueRbScheduleIntelligence(
      [],
      ratings,
      {
        requireCompleteSchedule:
          false
      }
    );

  assert.strictEqual(
    result.available,
    false
  );

  assert.ok(
    result.problems.some(
      function (
        problem
      ) {
        return problem.includes(
          "Expected 32 unique defense ratings"
        );
      }
    )
  );
})();

(function testCustomWindowsAndEndToEndDirection() {
  const ratings =
    makeRatings();

  const schedule = [
    {
      week: 1,
      away:
        "SF",
      home:
        "ARI"
    },

    {
      week: 1,
      away:
        "MIA",
      home:
        "ATL"
    },

    {
      week: 14,
      away:
        "SF",
      home:
        "BAL"
    },

    {
      week: 14,
      away:
        "MIA",
      home:
        "NYG"
    },

    {
      week: 15,
      away:
        "SF",
      home:
        "BUF"
    },

    {
      week: 15,
      away:
        "MIA",
      home:
        "NYJ"
    },

    {
      week: 16,
      away:
        "SF",
      home:
        "CAR"
    },

    {
      week: 16,
      away:
        "MIA",
      home:
        "PHI"
    },

    {
      week: 17,
      away:
        "SF",
      home:
        "CLE"
    },

    {
      week: 17,
      away:
        "MIA",
      home:
        "PIT"
    }
  ];

  const result =
    buildLeagueRbScheduleIntelligence(
      schedule,
      ratings,
      {
        requireCompleteSchedule:
          false,

        windows: {
          playoffs14to16: [
            14,
            15,
            16
          ],

          playoffs15to17: [
            15,
            16,
            17
          ]
        }
      }
    );

  assert.strictEqual(
    result.available,
    true
  );

  const sf =
    result.teams.find(
      function (
        row
      ) {
        return row.team ===
          "SF";
      }
    );

  const mia =
    result.teams.find(
      function (
        row
      ) {
        return row.team ===
          "MIA";
      }
    );

  assert.deepStrictEqual(
    sf.windows.playoffs14to16.weeks,
    [
      14,
      15,
      16
    ]
  );

  assert.deepStrictEqual(
    sf.windows.playoffs15to17.weeks,
    [
      15,
      16,
      17
    ]
  );

  assert.ok(
    finite(
      sf.windows.playoffs14to16.averageDifficultyScore
    )
  );

  assert.ok(
    finite(
      mia.windows.playoffs14to16.averageDifficultyScore
    )
  );
})();

function finite(
  value
) {
  return Number.isFinite(
    Number(
      value
    )
  );
}

console.log(
  "sage-rb-schedule-preseason.test.js: all tests passed"
);
