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
//   weekly-sage-wr-final-score
//
// ARCHITECTURE
// ------------
// The snapshot defines the eligible WR population.
//
// This function then calls weekly-sage-wr-final-score for each WR.
//
// It DOES NOT:
// - call Tank01 directly
// - rebuild player evidence
// - recalculate WR benchmarks
// - recalculate component formulas
// - duplicate confidence logic
// - duplicate matchup logic
// - define START / FLEX / SIT thresholds
//
// WHY THIS EXISTS
// ---------------
// Individual-player testing is useful for architecture validation.
//
// Historical model validation requires a complete weekly population:
//
//   WR population
//      ↓
//   final SAGE score for each WR
//      ↓
//   ranked weekly leaderboard
//      ↓
//   compare forecast against actual fantasy outcome
//
// IMPORTANT
// ---------
// The WR final-score weights are still provisional.
//
// This leaderboard exposes the scores.
// It does not validate the weights.
//
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_SEASON_TYPE =
  "reg";

const POSITION =
  "WR";

const SNAPSHOT_FUNCTION =
  "weekly-sage-wr-snapshot";

const FINAL_SCORE_FUNCTION =
  "weekly-sage-wr-final-score";

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

/*
  Keep concurrency modest.

  We do not want a leaderboard request to hammer downstream
  Netlify functions all at once.
*/
const DEFAULT_CONCURRENCY =
  5;

const MAX_CONCURRENCY =
  10;

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

/*
  Snapshot schema helper.

  The current WR snapshot may expose its population under
  players, rows, population, or receivers depending on the
  exact implementation version.

  We resolve known array locations explicitly instead of
  silently inventing player records.
*/
function extractSnapshotPlayers(
  snapshot
) {
  const candidates = [
    snapshot &&
      snapshot.players,

    snapshot &&
      snapshot.rows,

    snapshot &&
      snapshot.population,

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

  return {
    playerID,

    name:
      row.name ||
      row.longName ||
      row.playerName ||
      null,

    team:
      normalizeTeam(
        row.team ||
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

    position:
      POSITION,

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

function sortLeaderboard(
  rows
) {
  return rows.sort(
    function (
      a,
      b
    ) {
      /*
        Primary:
        higher SAGE score

        Secondary:
        higher confidence

        Tertiary:
        higher Role

        Final:
        alphabetical name for deterministic output
      */

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
  if (
    !rows.length
  ) {
    return {
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
        Retrieve the target week's pre-game WR population.
      */
      const snapshot =
        await fetchSnapshot({
          baseUrl,
          season,
          week:
            targetWeek,
          seasonType
        });

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
              "WR snapshot did not expose a recognizable player population.",

            evidenceType:
              snapshot.evidenceType ||
              null,

            detail:
              "Inspect weekly-sage-wr-snapshot output before changing leaderboard scoring logic."
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
        Optional limit is useful for endpoint testing.

        Example:
          ?season=2025&week=8&limit=10

        Historical validation should normally run without limit.
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

      /*
        STEP 2
        ------
        Calculate final SAGE for each WR.

        Failures are isolated to the individual player so one bad
        player record does not destroy the entire leaderboard.
      */
      const results =
        await mapWithConcurrency(
          players,
          concurrency,
          async function (
            player
          ) {
            try {
              const finalData =
                await fetchFinalScore({
                  baseUrl,
                  season,
                  week:
                    targetWeek,
                  seasonType,
                  playerID:
                    player.playerID
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

      /*
        STEP 3
        ------
        Separate successful rows from failures.
      */
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
                ? result.player.playerID ||
                  null
                : null,

            name:
              result &&
              result.player
                ? result.player.name ||
                  null
                : null,

            team:
              result &&
              result.player
                ? result.player.team ||
                  null
                : null,

            error:
              result &&
              result.error
                ? (
                    result.error.message ||
                    String(
                      result.error
                    )
                  )
                : "Unknown leaderboard scoring failure."
          });
        }
      }

      /*
        STEP 4
        ------
        Rank successful WR forecasts.
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

      return jsonResponse(
        200,
        {
          evidenceType:
            "weekly-sage-wr-leaderboard",

          schemaVersion:
            1,

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

            tieBreakers: [
              "Higher overall SAGE confidence",
              "Higher confidence-adjusted Role Score",
              "Player name"
            ],

            important:
              "This endpoint ranks existing WR final scores. It does not independently calculate or alter the SAGE methodology."
          },

          population: {
            snapshotPlayersReturned:
              populationReturned,

            playersRequested:
              players.length,

            scoresReturned:
              leaderboard.length,

            failuresReturned:
              failures.length,

            limitApplied:
              requestedLimit,

            concurrency
          },

          scoreSummary,

          leaderboard,

          failures,

          nextStep: {
            ready:
              leaderboard.length >
              0,

            reason:
              "Use weekly WR leaderboard observations as the forecast population for historical outcome validation and Role / Production / Matchup weight sensitivity."
          },

          architecture: {
            modelVersion:
              "wr-sage-v1",

            populationSource:
              SNAPSHOT_FUNCTION,

            scoringSource:
              FINAL_SCORE_FUNCTION,

            directTank01Calls:
              0,

            populationRebuiltForEachPlayer:
              false
          },

          provenance: {
            peerPopulation:
              SNAPSHOT_FUNCTION,

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
