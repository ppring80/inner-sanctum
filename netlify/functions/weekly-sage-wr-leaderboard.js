// netlify/functions/weekly-sage-wr-leaderboard.js
//
// WEEKLY SAGE — WR LEADERBOARD
//
// PURPOSE
// -------
// Build a complete Weekly SAGE WR leaderboard for one target week.
//
// SOURCES
// -------
//
//   weekly-sage-wr-snapshot
//   weekly-sage-schedule
//   weekly-sage-wr-final-score
//
// ARCHITECTURE
// ------------
// The snapshot defines the eligible WR population.
//
// The weekly schedule determines whether each player's historical
// team is ACTIVE or on BYE in the target week.
//
// Only active WRs are sent to weekly-sage-wr-final-score.
//
// This prevents bye weeks from being incorrectly reported as
// scoring failures and avoids unnecessary downstream function calls.
//
// This function DOES NOT:
// - call Tank01 directly
// - rebuild WR evidence
// - recalculate benchmarks
// - recalculate WR components
// - duplicate confidence logic
// - duplicate matchup logic
// - alter the underlying Weekly SAGE score when assigning START / FLEX / SIT
//
// IMPORTANT
// ---------
// WR SAGE v1 weights remain provisional.
//
// This leaderboard exposes the current forecast population for
// historical validation. It does not validate or optimize weights.
//
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_SEASON_TYPE =
  "reg";

const POSITION =
  "WR";

const SNAPSHOT_FUNCTION =
  "weekly-sage-wr-snapshot";

const SCHEDULE_FUNCTION =
  "weekly-sage-schedule";

const FINAL_SCORE_FUNCTION =
  "weekly-sage-wr-final-score";

/*
  weekly-sage-wr-final-score's core computation (buildWrFinalScore)
  is required directly, in-process, rather than invoked over HTTP
  (see fetchFinalScore() below, now unused but left in place for
  reference). This is the top of the chain: the snapshot this file
  already fetches exactly once at STEP 1 below is passed down by
  reference as prebuiltSnapshot to every one of the ~N per-WR calls,
  instead of each one (through final-score -> confidence ->
  component-scores -> benchmarks) independently rebuilding the
  entire WR population snapshot from scratch -- the redundancy this
  whole fix exists to remove.
*/
const {
  buildWrFinalScore
} = require(
  "./weekly-sage-wr-final-score.js"
);

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

const DEFAULT_CONCURRENCY =
  5;

const MAX_CONCURRENCY =
  10;

const WR_RECOMMENDATION_THRESHOLDS = {
  start: 72,
  flex: 52
};

function wrRecommendation(
  score
) {
  const value =
    nullableNum(
      score
    );

  if (
    value ===
    null
  ) {
    return null;
  }

  if (
    value >=
    WR_RECOMMENDATION_THRESHOLDS.start
  ) {
    return "START";
  }

  if (
    value >=
    WR_RECOMMENDATION_THRESHOLDS.flex
  ) {
    return "FLEX";
  }

  return "SIT";
}

function nullableNum(
  value
) {
  const n =
    Number(
      value
    );

  return Number.isFinite(
    n
  )
    ? n
    : null;
}

function integerOrNull(
  value
) {
  const n =
    Number(
      value
    );

  return Number.isInteger(
    n
  )
    ? n
    : null;
}

function round(
  value,
  digits = 1
) {
  const n =
    Number(
      value
    );

  if (
    !Number.isFinite(
      n
    )
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

function clamp(
  value,
  min,
  max
) {
  return Math.max(
    min,
    Math.min(
      max,
      value
    )
  );
}

function normalizeTeam(
  value
) {
  return String(
    value ||
    ""
  )
    .trim()
    .toUpperCase();
}

function normalizePosition(
  value
) {
  return String(
    value ||
    ""
  )
    .trim()
    .toUpperCase();
}

function getBaseUrl(
  event
) {
  const headers =
    event.headers ||
    {};

  const proto =
    headers[
      "x-forwarded-proto"
    ] ||
    headers[
      "X-Forwarded-Proto"
    ] ||
    "https";

  const host =
    headers.host ||
    headers.Host;

  if (
    !host
  ) {
    throw new Error(
      "Could not determine host."
    );
  }

  return (
    `${proto}://${host}`
  );
}

function buildUrl({
  baseUrl,
  functionName,
  params
}) {
  const query =
    new URLSearchParams(
      params
    ).toString();

  return (
    `${baseUrl}/.netlify/functions/${functionName}` +
    `?${query}`
  );
}

async function fetchJson(
  url
) {
  const response =
    await fetch(
      url,
      {
        method:
          "GET",

        headers: {
          Accept:
            "application/json"
        }
      }
    );

  let data =
    null;

  try {
    data =
      await response
        .json();
  } catch (
    error
  ) {
    data =
      null;
  }

  if (
    !response.ok
  ) {
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

    const err =
      new Error(
        detail
      );

    err.status =
      response.status;

    err.data =
      data;

    throw err;
  }

  return data;
}

async function fetchSnapshot({
  baseUrl,
  season,
  week,
  seasonType
}) {
  const url =
    buildUrl({
      baseUrl,

      functionName:
        SNAPSHOT_FUNCTION,

      params: {
        season,

        week:
          String(
            week
          ),

        seasonType
      }
    });

  const data =
    await fetchJson(
      url
    );

  if (
    !data ||
    data.evidenceType !==
      "weekly-sage-wr-snapshot"
  ) {
    throw new Error(
      "Unexpected Weekly SAGE WR snapshot schema."
    );
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
    buildUrl({
      baseUrl,

      functionName:
        SCHEDULE_FUNCTION,

      params: {
        season,

        week:
          String(
            week
          ),

        seasonType
      }
    });

  const data =
    await fetchJson(
      url
    );

  if (
    !data ||
    data.evidenceType !==
      "weekly-sage-schedule"
  ) {
    throw new Error(
      "Unexpected Weekly SAGE schedule schema."
    );
  }

  return data;
}

async function fetchFinalScore({
  baseUrl,
  season,
  week,
  seasonType,
  playerID
}) {
  const url =
    buildUrl({
      baseUrl,

      functionName:
        FINAL_SCORE_FUNCTION,

      params: {
        season,

        week:
          String(
            week
          ),

        seasonType,

        playerID
      }
    });

  return await fetchJson(
    url
  );
}

function extractSnapshotPlayers(
  snapshot
) {
  const candidates = [
    snapshot &&
      snapshot.population,

    snapshot &&
      snapshot.players,

    snapshot &&
      snapshot.rows,

    snapshot &&
      snapshot.receivers,

    snapshot &&
      snapshot.wrs,

    snapshot &&
      snapshot.data &&
      snapshot.data.players,

    snapshot &&
      snapshot.data &&
      snapshot.data.rows
  ];

  for (
    const candidate of
    candidates
  ) {
    if (
      Array.isArray(
        candidate
      )
    ) {
      return candidate;
    }
  }

  return [];
}

function normalizeSnapshotPlayer(
  row
) {
  if (
    !row ||
    typeof row !==
      "object"
  ) {
    return null;
  }

  const playerID =
    String(
      row.playerID ||
      row.playerId ||
      row.id ||
      ""
    ).trim();

  if (
    !playerID
  ) {
    return null;
  }

  const position =
    normalizePosition(
      row.position ||
      row.pos ||
      POSITION
    );

  if (
    position &&
    position !==
      POSITION
  ) {
    return null;
  }

  /*
    IMPORTANT:
    row.team is the historical team entering the target week.

    currentTeam is preserved separately.

    Historical team is authoritative for historical schedule
    classification.
  */
  return {
    playerID,

    name:
      row.name ||
      row.longName ||
      row.playerName ||
      null,

    team:
      normalizeTeam(
        row.team
      ) ||
      null,

    currentTeam:
      normalizeTeam(
        row.currentTeam
      ) ||
      null,

    position:
      POSITION,

    gamesUsed:
      nullableNum(
        row.gamesUsed
      ),

    weeksIncluded:
      Array.isArray(
        row.weeksIncluded
      )
        ? row.weeksIncluded
        : []
  };
}

function dedupePlayers(
  players
) {
  const seen =
    new Set();

  const result =
    [];

  for (
    const player of
    players
  ) {
    if (
      !player ||
      !player.playerID
    ) {
      continue;
    }

    if (
      seen.has(
        player.playerID
      )
    ) {
      continue;
    }

    seen.add(
      player.playerID
    );

    result.push(
      player
    );
  }

  return result;
}

function buildScheduleState(
  schedule
) {
  const activeTeams =
    new Set();

  const byeTeams =
    new Set();

  const games =
    Array.isArray(
      schedule.games
    )
      ? schedule.games
      : [];

  for (
    const game of
    games
  ) {
    const away =
      normalizeTeam(
        game.away
      );

    const home =
      normalizeTeam(
        game.home
      );

    if (
      away
    ) {
      activeTeams.add(
        away
      );
    }

    if (
      home
    ) {
      activeTeams.add(
        home
      );
    }
  }

  if (
    Array.isArray(
      schedule.activeTeams
    )
  ) {
    for (
      const team of
      schedule.activeTeams
    ) {
      const normalized =
        normalizeTeam(
          team
        );

      if (
        normalized
      ) {
        activeTeams.add(
          normalized
        );
      }
    }
  }

  if (
    Array.isArray(
      schedule.byeTeams
    )
  ) {
    for (
      const team of
      schedule.byeTeams
    ) {
      const normalized =
        normalizeTeam(
          team
        );

      if (
        normalized
      ) {
        byeTeams.add(
          normalized
        );
      }
    }
  }

  return {
    activeTeams,

    byeTeams
  };
}

function classifyPlayerSchedule(
  player,
  scheduleState
) {
  const team =
    normalizeTeam(
      player.team
    );

  if (
    !team
  ) {
    return {
      status:
        "unresolved",

      reason:
        "Historical team entering the target week is unavailable."
    };
  }

  if (
    scheduleState
      .activeTeams
      .has(
        team
      )
  ) {
    return {
      status:
        "active",

      reason:
        null
    };
  }

  if (
    scheduleState
      .byeTeams
      .has(
        team
      )
  ) {
    return {
      status:
        "bye",

      reason:
        "Player's historical team is on bye in the requested week."
    };
  }

  /*
    For a complete regular-season weekly schedule, absence means bye.

    However, we only infer that when the schedule endpoint explicitly
    says bye classification is available.
  */
  return {
    status:
      "unresolved",

    reason:
      "Player team does not appear in the active schedule and was not explicitly classified as a bye team."
  };
}

async function mapWithConcurrency(
  items,
  concurrency,
  mapper
) {
  const results =
    new Array(
      items.length
    );

  let nextIndex =
    0;

  async function worker() {
    while (
      true
    ) {
      const index =
        nextIndex;

      nextIndex +=
        1;

      if (
        index >=
        items.length
      ) {
        return;
      }

      try {
        results[
          index
        ] =
          await mapper(
            items[
              index
            ],
            index
          );
      } catch (
        error
      ) {
        results[
          index
        ] = {
          ok:
            false,

          error
        };
      }
    }
  }

  const workerCount =
    Math.min(
      concurrency,
      items.length
    );

  if (
    workerCount <=
    0
  ) {
    return results;
  }

  await Promise.all(
    Array.from(
      {
        length:
          workerCount
      },
      function () {
        return worker();
      }
    )
  );

  return results;
}

function leaderboardRow(
  finalData
) {
  if (
    !finalData ||
    finalData.evidenceType !==
      "weekly-sage-wr-final-score"
  ) {
    return null;
  }

  const player =
    finalData.player ||
    {};

  const sage =
    finalData.sage ||
    {};

  const components =
    finalData.components ||
    {};

  const role =
    components.role ||
    {};

  const production =
    components.production ||
    {};

  const matchup =
    components.matchup ||
    {};

  const upcomingGame =
    finalData.upcomingGame ||
    {};

  const score =
    nullableNum(
      sage.score
    );

  if (
    score ===
    null
  ) {
    return null;
  }

  return {
    rank:
      null,

    playerID:
      player.playerID ||
      null,

    name:
      player.name ||
      null,

    team:
      normalizeTeam(
        player.team
      ) ||
      null,

    currentTeam:
      normalizeTeam(
        player.currentTeam
      ) ||
      null,

    position:
      POSITION,

    status:
      "active",

    eligibleForWeeklyRanking:
      true,

    gamesUsed:
      nullableNum(
        player.gamesUsed
      ),

    opponent:
      normalizeTeam(
        upcomingGame.opponent ||
        matchup.opponent
      ) ||
      null,

    location:
      upcomingGame.location ||
      null,

    gameID:
      upcomingGame.gameID ||
      null,

    gameDate:
      upcomingGame.gameDate ||
      null,

    gameTime:
      upcomingGame.gameTime ||
      null,

    sageScore:
      score,

    recommendation:
      wrRecommendation(
        score
      ),

    sageLabel:
      sage.label ||
      null,

    sageConfidence:
      nullableNum(
        sage &&
        sage.confidence &&
        sage.confidence.weight
      ),

    sageConfidenceLabel:
      sage &&
      sage.confidence
        ? sage.confidence.label ||
          null
        : null,

    role: {
      rawScore:
        nullableNum(
          role.rawScore
        ),

      adjustedScore:
        nullableNum(
          role.adjustedScore
        ),

      confidence:
        nullableNum(
          role &&
          role.confidence &&
          role.confidence.weight
        ),

      weightedContribution:
        nullableNum(
          role.weightedContribution
        )
    },

    production: {
      rawScore:
        nullableNum(
          production.rawScore
        ),

      adjustedScore:
        nullableNum(
          production.adjustedScore
        ),

      confidence:
        nullableNum(
          production &&
          production.confidence &&
          production.confidence.weight
        ),

      weightedContribution:
        nullableNum(
          production.weightedContribution
        )
    },

    matchup: {
      rawScore:
        nullableNum(
          matchup.rawScore
        ),

      adjustedScore:
        nullableNum(
          matchup.adjustedScore
        ),

      confidence:
        nullableNum(
          matchup &&
          matchup.confidence &&
          matchup.confidence.weight
        ),

      weightedContribution:
        nullableNum(
          matchup.weightedContribution
        ),

      signal:
        matchup.signal ||
        null,

      label:
        matchup.label ||
        null
    }
  };
}

function inactiveRow(
  player,
  reason
) {
  return {
    playerID:
      player.playerID,

    name:
      player.name ||
      null,

    team:
      player.team ||
      null,

    currentTeam:
      player.currentTeam ||
      null,

    position:
      POSITION,

    status:
      "bye",

    eligibleForWeeklyRanking:
      false,

    opponent:
      null,

    location:
      null,

    sage: {
      score:
        null,

      label:
        null,

      confidence:
        null,

      confidenceLabel:
        null
    },

    recommendation:
      null,

    reason
  };
}

function unresolvedRow(
  player,
  reason
) {
  return {
    playerID:
      player.playerID,

    name:
      player.name ||
      null,

    team:
      player.team ||
      null,

    currentTeam:
      player.currentTeam ||
      null,

    position:
      POSITION,

    status:
      "unresolved",

    eligibleForWeeklyRanking:
      false,

    reason
  };
}

function sortLeaderboard(
  rows
) {
  return rows.sort(
    function (
      a,
      b
    ) {
      const scoreDiff =
        (
          nullableNum(
            b.sageScore
          ) ||
          0
        ) -
        (
          nullableNum(
            a.sageScore
          ) ||
          0
        );

      if (
        scoreDiff !==
        0
      ) {
        return scoreDiff;
      }

      const confidenceDiff =
        (
          nullableNum(
            b.sageConfidence
          ) ||
          0
        ) -
        (
          nullableNum(
            a.sageConfidence
          ) ||
          0
        );

      if (
        confidenceDiff !==
        0
      ) {
        return confidenceDiff;
      }

      const roleDiff =
        (
          nullableNum(
            b.role &&
            b.role.adjustedScore
          ) ||
          0
        ) -
        (
          nullableNum(
            a.role &&
            a.role.adjustedScore
          ) ||
          0
        );

      if (
        roleDiff !==
        0
      ) {
        return roleDiff;
      }

      return String(
        a.name ||
        ""
      ).localeCompare(
        String(
          b.name ||
          ""
        )
      );
    }
  );
}

function applyRanks(
  rows
) {
  let previousScore =
    null;

  let previousRank =
    0;

  for (
    let i = 0;
    i <
    rows.length;
    i += 1
  ) {
    const row =
      rows[
        i
      ];

    const score =
      nullableNum(
        row.sageScore
      );

    if (
      i ===
        0 ||
      score !==
        previousScore
    ) {
      previousRank =
        i +
        1;
    }

    row.rank =
      previousRank;

    previousScore =
      score;
  }

  return rows;
}

function summarizeScores(
  rows
) {
  const scores =
    rows
      .map(
        function (
          row
        ) {
          return nullableNum(
            row.sageScore
          );
        }
      )
      .filter(
        function (
          value
        ) {
          return (
            value !==
            null
          );
        }
      )
      .sort(
        function (
          a,
          b
        ) {
          return (
            a -
            b
          );
        }
      );

  if (
    !scores.length
  ) {
    return {
      count:
        0,

      minimum:
        null,

      maximum:
        null,

      average:
        null,

      median:
        null
    };
  }

  const total =
    scores.reduce(
      function (
        sum,
        value
      ) {
        return (
          sum +
          value
        );
      },
      0
    );

  const middle =
    Math.floor(
      scores.length /
      2
    );

  const median =
    scores.length %
      2 ===
    0
      ? (
          scores[
            middle -
            1
          ] +
          scores[
            middle
          ]
        ) /
        2
      : scores[
          middle
        ];

  return {
    count:
      scores.length,

    minimum:
      round(
        scores[
          0
        ],
        1
      ),

    maximum:
      round(
        scores[
          scores.length -
          1
        ],
        1
      ),

    average:
      round(
        total /
        scores.length,
        1
      ),

    median:
      round(
        median,
        1
      )
  };
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
        cacheControl ||
        "no-store"
    },

    body:
      JSON.stringify(
        body,
        null,
        2
      )
  };
}

exports.handler =
  async function (
    event
  ) {
    if (
      event.httpMethod &&
      event.httpMethod !==
        "GET"
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
      event
        .queryStringParameters ||
      {};

    const season =
      String(
        query.season ||
        new Date()
          .getFullYear()
      );

    const targetWeek =
      Number(
        query.week
      );

    const seasonType =
      String(
        query.seasonType ||
        DEFAULT_SEASON_TYPE
      );

    const requestedLimit =
      integerOrNull(
        query.limit
      );

    const requestedConcurrency =
      integerOrNull(
        query.concurrency
      );

    const concurrency =
      clamp(
        requestedConcurrency ||
        DEFAULT_CONCURRENCY,
        1,
        MAX_CONCURRENCY
      );

    if (
      !Number.isInteger(
        targetWeek
      ) ||
      targetWeek <
        2 ||
      targetWeek >
        18
    ) {
      return jsonResponse(
        400,
        {
          error:
            "week must be an integer from 2 through 18."
        }
      );
    }

    if (
      ![
        "reg",
        "pre",
        "post",
        "all"
      ].includes(
        seasonType
      )
    ) {
      return jsonResponse(
        400,
        {
          error:
            "seasonType must be reg, pre, post, or all."
        }
      );
    }

    if (
      requestedLimit !==
        null &&
      requestedLimit <
        1
    ) {
      return jsonResponse(
        400,
        {
          error:
            "limit must be a positive integer."
        }
      );
    }

    try {
      const baseUrl =
        getBaseUrl(
          event
        );

      /*
        STEP 1
        ------
        Retrieve WR peer population and target-week schedule ONCE.
      */
      const [
        snapshot,
        schedule
      ] =
        await Promise.all([
          fetchSnapshot({
            baseUrl,
            season,
            week:
              targetWeek,
            seasonType
          }),

          fetchSchedule({
            baseUrl,
            season,
            week:
              targetWeek,
            seasonType
          })
        ]);

      const rawPlayers =
        extractSnapshotPlayers(
          snapshot
        );

      if (
        !rawPlayers.length
      ) {
        return jsonResponse(
          422,
          {
            error:
              "WR snapshot did not expose a recognizable player population."
          }
        );
      }

      let players =
        dedupePlayers(
          rawPlayers
            .map(
              normalizeSnapshotPlayer
            )
            .filter(
              Boolean
            )
        );

      const populationReturned =
        players.length;

      /*
        limit remains useful for cheap architecture tests.
      */
      if (
        requestedLimit !==
        null
      ) {
        players =
          players.slice(
            0,
            requestedLimit
          );
      }

      const scheduleState =
        buildScheduleState(
          schedule
        );

      /*
        STEP 2
        ------
        Classify ACTIVE / BYE / UNRESOLVED before scoring.

        Bye players never call final-score.
      */
      const activePlayers =
        [];

      const inactive =
        [];

      const unresolved =
        [];

      for (
        const player of
        players
      ) {
        const classification =
          classifyPlayerSchedule(
            player,
            scheduleState
          );

        if (
          classification.status ===
          "active"
        ) {
          activePlayers.push(
            player
          );

          continue;
        }

        if (
          classification.status ===
          "bye"
        ) {
          inactive.push(
            inactiveRow(
              player,
              classification.reason
            )
          );

          continue;
        }

        unresolved.push(
          unresolvedRow(
            player,
            classification.reason
          )
        );
      }

      /*
        STEP 3
        ------
        Only active WRs invoke final-score.
      */
      const results =
        await mapWithConcurrency(
          activePlayers,
          concurrency,
          async function (
            player
          ) {
            try {
              const finalData =
                await buildWrFinalScore({
                  baseUrl,
                  season,
                  targetWeek,
                  seasonType,
                  playerID:
                    player.playerID,

                  prebuiltSnapshot:
                    snapshot
                });

              const row =
                leaderboardRow(
                  finalData
                );

              if (
                !row
              ) {
                return {
                  ok:
                    false,

                  player,

                  error:
                    "Final-score endpoint did not return a usable WR SAGE score."
                };
              }

              return {
                ok:
                  true,

                player,

                row
              };
            } catch (
              error
            ) {
              return {
                ok:
                  false,

                player,

                error:
                  error &&
                  error.message
                    ? error.message
                    : String(
                        error
                      )
              };
            }
          }
        );

      const rows =
        [];

      const failures =
        [];

      for (
        const result of
        results
      ) {
        if (
          result &&
          result.ok &&
          result.row
        ) {
          rows.push(
            result.row
          );
        } else {
          failures.push({
            playerID:
              result &&
              result.player
                ? result
                    .player
                    .playerID ||
                  null
                : null,

            name:
              result &&
              result.player
                ? result
                    .player
                    .name ||
                  null
                : null,

            team:
              result &&
              result.player
                ? result
                    .player
                    .team ||
                  null
                : null,

            error:
              result &&
              result.error
                ? String(
                    result.error
                  )
                : "Unknown leaderboard scoring failure."
          });
        }
      }

      /*
        STEP 4
        ------
        Rank active scored WRs.
      */
      const leaderboard =
        applyRanks(
          sortLeaderboard(
            rows
          )
        );

      const scoreSummary =
        summarizeScores(
          leaderboard
        );

      const ready =
        leaderboard.length >
          0 &&
        failures.length ===
          0 &&
        unresolved.length ===
          0;

      return jsonResponse(
        200,
        {
          evidenceType:
            "weekly-sage-wr-leaderboard",

          schemaVersion:
            2,

          generatedAt:
            new Date()
              .toISOString(),

          season,

          targetWeek,

          seasonType,

          position:
            POSITION,

          methodology: {
            modelVersion:
              "wr-sage-v1",

            status:
              "Provisional pending WR historical weight validation.",

            ranking:
              "Descending Weekly SAGE WR Score.",

            recommendationThresholds: {
              start:
                WR_RECOMMENDATION_THRESHOLDS.start,

              flex:
                WR_RECOMMENDATION_THRESHOLDS.flex,

              definitions: {
                START:
                  "Weekly SAGE Score >= 72",

                FLEX:
                  "Weekly SAGE Score >= 52 and < 72",

                SIT:
                  "Weekly SAGE Score < 52"
              },

              status:
                "Initial WR consumer recommendation thresholds calibrated from saved 2025 Week 5 and Week 8 historical evidence."
            },

            tieBreakers: [
              "Higher overall SAGE confidence",
              "Higher confidence-adjusted Role Score",
              "Player name"
            ],

            byeHandling:
              "Players whose historical target-week team is on bye are excluded before final-score execution and reported separately as inactive.",

            historicalIdentity:
              "The WR snapshot's historical team entering the target week is authoritative for schedule classification.",

            important:
              "This endpoint ranks existing WR final scores. It does not independently calculate or alter SAGE methodology."
          },

          architecture: {
            modelVersion:
              "wr-sage-v1",

            populationSource:
              SNAPSHOT_FUNCTION,

            scheduleSource:
              SCHEDULE_FUNCTION,

            scoringSource:
              FINAL_SCORE_FUNCTION,

            populationRebuiltByLeaderboard:
              false,

            directTank01Calls:
              0,

            byePlayersSentToFinalScore:
              0
          },

          population: {
            snapshotPlayersReturned:
              populationReturned,

            playersRequested:
              players.length,

            activePlayers:
              activePlayers.length,

            activePlayersScored:
              leaderboard.length,

            inactiveByePlayers:
              inactive.length,

            unresolvedPlayers:
              unresolved.length,

            failures:
              failures.length,

            limitApplied:
              requestedLimit,

            concurrency
          },

          scheduleClassification: {
            activeTeamsReturned:
              scheduleState
                .activeTeams
                .size,

            byeTeamsReturned:
              scheduleState
                .byeTeams
                .size,

            activeTeams:
              Array.from(
                scheduleState
                  .activeTeams
              ).sort(),

            byeTeams:
              Array.from(
                scheduleState
                  .byeTeams
              ).sort()
          },

          scoreSummary,

          leaderboard,

          inactive,

          unresolved,

          failures,

          recommendation: {
            enabled:
              true,

            startThreshold:
              WR_RECOMMENDATION_THRESHOLDS.start,

            flexThreshold:
              WR_RECOMMENDATION_THRESHOLDS.flex,

            logic:
              "START >= 72; FLEX >= 52 and < 72; SIT < 52"
          },

          nextStep: {
            ready,

            reason:
              ready
                ? "Active WRs were scored successfully, bye-week WRs were excluded before final-score execution, and START / FLEX / SIT recommendations were assigned from the calibrated WR SAGE thresholds."
                : "Resolve unresolved players or true scoring failures before using this weekly leaderboard for consumer recommendations."
          },

          provenance: {
            peerPopulation:
              SNAPSHOT_FUNCTION,

            participation:
              SCHEDULE_FUNCTION,

            finalScore:
              FINAL_SCORE_FUNCTION,

            componentSource:
              "weekly-sage-wr-component-scores",

            confidenceSource:
              "weekly-sage-wr-confidence",

            matchupSource:
              "weekly-sage-player-matchup"
          }
        },

        CACHE_CONTROL
      );
    } catch (
      error
    ) {
      console.error(
        "weekly-sage-wr-leaderboard failed:",
        error
      );

      return jsonResponse(
        502,
        {
          error:
            "Could not build Weekly SAGE WR leaderboard.",

          detail:
            error &&
            error.message
              ? error.message
              : String(
                  error
                )
        }
      );
    }
  };
