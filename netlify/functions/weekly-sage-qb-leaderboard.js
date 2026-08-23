// netlify/functions/weekly-sage-qb-leaderboard.js
//
// WEEKLY SAGE — QB LEADERBOARD
//
// Reads the cached QB snapshot, removes bye/unresolved players before scoring,
// scores active QBs through the existing in-process QB chain, and ranks them.
// Missing/invalid QB snapshot cache fails fast with 503; there is no live rebuild.
// START/FLEX/SIT thresholds are provisional placeholders until QB validation.

const { connectLambda, getStore } = require("@netlify/blobs");
const { buildQbFinalScore } = require("./weekly-sage-qb-final-score.js");

const DEFAULT_SEASON_TYPE = "reg";
const POSITION = "QB";
const QB_SNAPSHOT_STORE = "qb-snapshot";
const SCHEDULE_FUNCTION = "weekly-sage-schedule";
const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";
const DEFAULT_CONCURRENCY = 5;
const MAX_CONCURRENCY = 10;

const QB_RECOMMENDATION_THRESHOLDS = {
  start: 72,
  flex: 52
};

function nullableNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function integerOrNull(value) {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function round(value, digits = 1) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return null;
  }

  const factor = 10 ** digits;

  return Math.round(
    (n + Number.EPSILON) * factor
  ) / factor;
}

function clamp(value, min, max) {
  return Math.max(
    min,
    Math.min(
      max,
      value
    )
  );
}

function normalizeTeam(value) {
  const raw =
    String(value || "")
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

  return aliases[raw] || raw;
}

function getBaseUrl(event) {
  const headers =
    event.headers || {};

  const proto =
    headers["x-forwarded-proto"] ||
    headers["X-Forwarded-Proto"] ||
    "https";

  const host =
    headers.host ||
    headers.Host;

  if (!host) {
    throw new Error(
      "Could not determine host."
    );
  }

  return `${proto}://${host}`;
}

function jsonResponse(
  statusCode,
  body,
  cacheControl = "no-store"
) {
  return {
    statusCode,

    headers: {
      "Content-Type":
        "application/json",

      "Cache-Control":
        cacheControl
    },

    body:
      JSON.stringify(
        body,
        null,
        2
      )
  };
}

async function fetchJson(url) {
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
      await response.json();
  } catch (error) {
    data =
      null;
  }

  if (!response.ok) {
    const rawDetail =
      data &&
      (
        data.detail ||
        data.error
      );

    let detail =
      `HTTP ${response.status}`;

    if (
      typeof rawDetail ===
      "string"
    ) {
      detail =
        rawDetail;
    } else if (
      rawDetail &&
      typeof rawDetail ===
        "object"
    ) {
      try {
        detail =
          JSON.stringify(
            rawDetail
          );
      } catch (error) {
        detail =
          String(
            rawDetail
          );
      }
    }

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

function cacheError(
  reason,
  detail
) {
  const err =
    new Error(
      reason
    );

  err.status =
    503;

  err.detail =
    detail || null;

  return err;
}

async function readCachedSnapshot({
  season,
  targetWeek,
  seasonType
}) {
  const key =
    `week:${season}:${targetWeek}:${seasonType}`;

  let cached =
    null;

  try {
    const store =
      getStore({
        name:
          QB_SNAPSHOT_STORE
      });

    cached =
      await store.get(
        key,
        {
          type:
            "json"
        }
      );
  } catch (error) {
    throw cacheError(
      "QB snapshot cache could not be read.",
      {
        blobStore:
          QB_SNAPSHOT_STORE,

        blobKey:
          key,

        readError:
          error &&
          error.message
            ? error.message
            : String(
                error
              )
      }
    );
  }

  if (
    !cached ||
    typeof cached !==
      "object"
  ) {
    throw cacheError(
      "QB snapshot cache is missing for this season/week/seasonType.",
      {
        blobStore:
          QB_SNAPSHOT_STORE,

        blobKey:
          key
      }
    );
  }

  const problems =
    [];

  if (
    cached.evidenceType !==
    "weekly-sage-qb-snapshot"
  ) {
    problems.push(
      `Unexpected evidenceType: ${cached.evidenceType}`
    );
  }

  if (
    String(
      cached.season
    ) !==
    String(
      season
    )
  ) {
    problems.push(
      `Cached season (${cached.season}) does not match requested season (${season}).`
    );
  }

  if (
    Number(
      cached.targetWeek
    ) !==
    Number(
      targetWeek
    )
  ) {
    problems.push(
      `Cached targetWeek (${cached.targetWeek}) does not match requested week (${targetWeek}).`
    );
  }

  if (
    cached.seasonType !==
    seasonType
  ) {
    problems.push(
      `Cached seasonType (${cached.seasonType}) does not match requested seasonType (${seasonType}).`
    );
  }

  if (
    !Array.isArray(
      cached.population
    ) ||
    cached.population.length ===
      0
  ) {
    problems.push(
      "Cached snapshot has an empty or missing population."
    );
  }

  if (
    !Array.isArray(
      cached.failures
    ) ||
    cached.failures.length >
      0
  ) {
    problems.push(
      "Cached snapshot has one or more player-game failures."
    );
  }

  if (
    !cached.nextStep ||
    cached.nextStep.ready !==
      true
  ) {
    problems.push(
      "Cached snapshot's nextStep.ready is not true."
    );
  }

  if (
    problems.length
  ) {
    throw cacheError(
      "QB snapshot cache is invalid or not ready for use.",
      {
        blobStore:
          QB_SNAPSHOT_STORE,

        blobKey:
          key,

        problems
      }
    );
  }

  return cached;
}

async function fetchSchedule({
  baseUrl,
  season,
  week,
  seasonType
}) {
  const params =
    new URLSearchParams({
      season,
      week:
        String(
          week
        ),
      seasonType
    });

  const url =
    `${baseUrl}/.netlify/functions/${SCHEDULE_FUNCTION}?${params.toString()}`;

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

  if (!playerID) {
    return null;
  }

  const position =
    String(
      row.position ||
      row.pos ||
      POSITION
    )
      .trim()
      .toUpperCase();

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

function snapshotPlayers(
  snapshot
) {
  const raw =
    Array.isArray(
      snapshot.population
    )
      ? snapshot.population
      : [];

  const seen =
    new Set();

  const players =
    [];

  for (
    const row of
    raw
  ) {
    const player =
      normalizeSnapshotPlayer(
        row
      );

    if (
      !player ||
      seen.has(
        player.playerID
      )
    ) {
      continue;
    }

    seen.add(
      player.playerID
    );

    players.push(
      player
    );
  }

  return players;
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

    if (away) {
      activeTeams.add(
        away
      );
    }

    if (home) {
      activeTeams.add(
        home
      );
    }
  }

  for (
    const team of
    Array.isArray(
      schedule.activeTeams
    )
      ? schedule.activeTeams
      : []
  ) {
    const normalized =
      normalizeTeam(
        team
      );

    if (normalized) {
      activeTeams.add(
        normalized
      );
    }
  }

  for (
    const team of
    Array.isArray(
      schedule.byeTeams
    )
      ? schedule.byeTeams
      : []
  ) {
    const normalized =
      normalizeTeam(
        team
      );

    if (normalized) {
      byeTeams.add(
        normalized
      );
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

  if (!team) {
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
    while (true) {
      const index =
        nextIndex++;

      if (
        index >=
        items.length
      ) {
        return;
      }

      try {
        results[index] =
          await mapper(
            items[index],
            index
          );
      } catch (error) {
        results[index] = {
          ok:
            false,

          error
        };
      }
    }
  }

  const count =
    Math.min(
      concurrency,
      items.length
    );

  if (
    count >
    0
  ) {
    await Promise.all(
      Array.from(
        {
          length:
            count
        },
        () =>
          worker()
      )
    );
  }

  return results;
}

function qbRecommendation(
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
    QB_RECOMMENDATION_THRESHOLDS.start
  ) {
    return "START";
  }

  if (
    value >=
    QB_RECOMMENDATION_THRESHOLDS.flex
  ) {
    return "FLEX";
  }

  return "SIT";
}

function leaderboardRow(
  finalData
) {
  if (
    !finalData ||
    finalData.evidenceType !==
      "weekly-sage-qb-final-score"
  ) {
    return null;
  }

  const player =
    finalData.player || {};

  const sage =
    finalData.sage || {};

  const role =
    (
      finalData.components &&
      finalData.components.role
    ) ||
    {};

  const production =
    (
      finalData.components &&
      finalData.components.production
    ) ||
    {};

  const matchup =
    (
      finalData.components &&
      finalData.components.matchup
    ) ||
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
      qbRecommendation(
        score
      ),

    sageLabel:
      sage.label ||
      null,

    sageConfidence:
      nullableNum(
        sage.confidence &&
        sage.confidence.weight
      ),

    sageConfidenceLabel:
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

function sortAndRank(
  rows
) {
  rows.sort(
    (
      a,
      b
    ) => {
      const scoreDiff =
        (
          b.sageScore ||
          0
        ) -
        (
          a.sageScore ||
          0
        );

      if (
        scoreDiff
      ) {
        return scoreDiff;
      }

      const confidenceDiff =
        (
          b.sageConfidence ||
          0
        ) -
        (
          a.sageConfidence ||
          0
        );

      if (
        confidenceDiff
      ) {
        return confidenceDiff;
      }

      const roleDiff =
        (
          (
            b.role &&
            b.role.adjustedScore
          ) ||
          0
        ) -
        (
          (
            a.role &&
            a.role.adjustedScore
          ) ||
          0
        );

      if (
        roleDiff
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

  let previousScore =
    null;

  let previousRank =
    0;

  rows.forEach(
    (
      row,
      index
    ) => {
      if (
        index ===
          0 ||
        row.sageScore !==
          previousScore
      ) {
        previousRank =
          index +
          1;
      }

      row.rank =
        previousRank;

      previousScore =
        row.sageScore;
    }
  );

  return rows;
}

function summarizeScores(
  rows
) {
  const scores =
    rows
      .map(
        row =>
          nullableNum(
            row.sageScore
          )
      )
      .filter(
        value =>
          value !==
          null
      )
      .sort(
        (
          a,
          b
        ) =>
          a -
          b
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
      (
        sum,
        value
      ) =>
        sum +
        value,
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
        scores[0],
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

exports.handler =
  async function (
    event
  ) {
    connectLambda(
      event
    );

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
      event.queryStringParameters ||
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

      const [
        snapshot,
        schedule
      ] =
        await Promise.all([
          readCachedSnapshot({
            season,
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

      let players =
        snapshotPlayers(
          snapshot
        );

      const populationReturned =
        players.length;

      if (
        !players.length
      ) {
        return jsonResponse(
          422,
          {
            error:
              "QB snapshot did not expose a recognizable player population."
          }
        );
      }

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
        } else if (
          classification.status ===
          "bye"
        ) {
          inactive.push({
            playerID:
              player.playerID,

            name:
              player.name,

            team:
              player.team,

            currentTeam:
              player.currentTeam,

            position:
              POSITION,

            status:
              "bye",

            eligibleForWeeklyRanking:
              false,

            recommendation:
              null,

            reason:
              classification.reason
          });
        } else {
          unresolved.push({
            playerID:
              player.playerID,

            name:
              player.name,

            team:
              player.team,

            currentTeam:
              player.currentTeam,

            position:
              POSITION,

            status:
              "unresolved",

            eligibleForWeeklyRanking:
              false,

            reason:
              classification.reason
          });
        }
      }

      const results =
        await mapWithConcurrency(
          activePlayers,
          concurrency,
          async player => {
            try {
              const finalData =
                await buildQbFinalScore({
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

              return row
                ? {
                    ok:
                      true,

                    player,

                    row
                  }
                : {
                    ok:
                      false,

                    player,

                    error:
                      "Final-score computation did not return a usable QB SAGE score."
                  };
            } catch (error) {
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

      const scored =
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
          scored.push(
            result.row
          );
        } else {
          failures.push({
            playerID:
              result &&
              result.player
                ? result
                    .player
                    .playerID
                : null,

            name:
              result &&
              result.player
                ? result
                    .player
                    .name
                : null,

            team:
              result &&
              result.player
                ? result
                    .player
                    .team
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

      const leaderboard =
        sortAndRank(
          scored
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
            "weekly-sage-qb-leaderboard",

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
              "qb-sage-v1",

            status:
              "Provisional pending QB historical validation. Recommendation thresholds are placeholders, not QB-calibrated.",

            ranking:
              "Descending Weekly SAGE QB Score.",

            recommendationThresholds: {
              start:
                QB_RECOMMENDATION_THRESHOLDS.start,

              flex:
                QB_RECOMMENDATION_THRESHOLDS.flex,

              definitions: {
                START:
                  "Weekly SAGE Score >= 72",

                FLEX:
                  "Weekly SAGE Score >= 52 and < 72",

                SIT:
                  "Weekly SAGE Score < 52"
              },

              status:
                "PROVISIONAL: 72/52 are inherited numeric placeholders only."
            },

            tieBreakers: [
              "Higher overall SAGE confidence",
              "Higher confidence-adjusted Role Score",
              "Player name"
            ],

            byeHandling:
              "Bye players are excluded before final-score execution.",

            historicalIdentity:
              "Historical team entering the target week is authoritative for schedule classification."
          },

          architecture: {
            modelVersion:
              "qb-sage-v1",

            populationSource:
              "weekly-sage-qb-snapshot",

            snapshotStore:
              QB_SNAPSHOT_STORE,

            scheduleSource:
              SCHEDULE_FUNCTION,

            scoringSource:
              "weekly-sage-qb-final-score",

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

          scoreSummary:
            summarizeScores(
              leaderboard
            ),

          leaderboard,

          inactive,

          unresolved,

          failures,

          recommendation: {
            enabled:
              true,

            startThreshold:
              QB_RECOMMENDATION_THRESHOLDS.start,

            flexThreshold:
              QB_RECOMMENDATION_THRESHOLDS.flex,

            logic:
              "START >= 72; FLEX >= 52 and < 72; SIT < 52"
          },

          nextStep: {
            ready,

            reason:
              ready
                ? "Active QBs were scored successfully and bye-week QBs were excluded before scoring."
                : "Resolve unresolved players or true scoring failures before using this leaderboard."
          },

          provenance: {
            peerPopulation:
              "weekly-sage-qb-snapshot",

            participation:
              SCHEDULE_FUNCTION,

            finalScore:
              "weekly-sage-qb-final-score",

            componentSource:
              "weekly-sage-qb-component-scores",

            confidenceSource:
              "weekly-sage-qb-confidence",

            matchupSource:
              "weekly-sage-player-matchup"
          }
        },

        CACHE_CONTROL
      );
    } catch (error) {
      if (
        typeof (
          error &&
          error.status
        ) ===
        "number"
      ) {
        return jsonResponse(
          error.status,
          {
            error:
              error.message,

            detail:
              error.detail !==
                undefined
                ? error.detail
                : error.data ||
                  null
          }
        );
      }

      console.error(
        "weekly-sage-qb-leaderboard failed:",
        error
      );

      return jsonResponse(
        502,
        {
          error:
            "Could not build Weekly SAGE QB leaderboard.",

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
