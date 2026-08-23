// netlify/functions/weekly-sage-te-validation.js
//
// WEEKLY SAGE — TE HISTORICAL VALIDATION
//
// PURPOSE
// -------
// Compare the PRE-GAME Weekly SAGE TE forecast against what
// actually happened in the target week.
//
// Example:
//
//   targetWeek = 8
//
//   Prediction:
//     weekly-sage-te-leaderboard?week=8
//     -> built only from evidence available before Week 8
//
//   Outcome:
//     weekly-sage-player-season?week=9
//     -> contains Weeks 1 through 8
//     -> extract ONLY the Week 8 source game
//
// This preserves the frozen Week 8 SAGE prediction and uses
// the Week 8 result strictly as POST-GAME validation.
//
// VALIDATION OUTPUT
// -----------------
//
// For each TE who actually played:
//
//   playerID
//   name
//   team
//   sageRank
//   sageScore
//   sageConfidence
//
//   Role adjusted score
//   Production adjusted score
//   Matchup adjusted score
//
//   actual Standard points
//   actual Half-PPR points
//   actual PPR points
//
//   actual TE rank
//   rank difference
//
// Population analysis:
//
//   SAGE vs fantasy-point correlations
//   SAGE rank vs actual rank
//   Role vs outcome correlation
//   Production vs outcome correlation
//   Matchup vs outcome correlation
//
//   Top-12 capture
//   Top-24 capture
//   Top-36 capture
//
// IMPORTANT
// ---------
// This endpoint DOES NOT:
//
// - change SAGE scores
// - change TE component formulas
// - change Role / Production / Matchup weights
// - optimize weights
// - create START / FLEX / SIT thresholds
// - feed target-week outcomes back into the historical prediction
//
// PARTICIPATION
// -------------
//
// PLAYED
//   Included in forecast-vs-actual statistical analysis.
//
// BYE
//   Already excluded from weekly-sage-te-leaderboard.
//
// DID NOT PLAY
//   Historical team had a scheduled target-week game, but no
//   player-game record exists. Excluded from correlations.
//
// FAILURE
//   Outcome evidence could not be retrieved. Blocks clean validation.
//
// DNP is NEVER assigned zero fantasy points.
//
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_SEASON_TYPE =
  "reg";

const POSITION =
  "TE";

const LEADERBOARD_FUNCTION =
  "weekly-sage-te-leaderboard";

/*
  Retained as a plain string for output provenance/architecture
  metadata only (see the "architecture"/"provenance" fields in the
  response body below) -- this file no longer builds an HTTP URL
  from it, since weekly-sage-player-season's evidence is now
  produced by an in-process call instead of a self-fetch.
*/
const PLAYER_SEASON_FUNCTION =
  "weekly-sage-player-season";

/*
  weekly-sage-player-season's core computation
  (buildPlayerSeason) and its shared schedule-map builder
  (buildPriorWeekScheduleMap) are required directly, in-process,
  rather than invoked over HTTP.

  Previously this file called weekly-sage-player-season once per TE
  over HTTP, and that function independently rebuilt the SAME Weeks
  1..targetWeek schedule evidence inside every one of those calls --
  identical data, redundantly rebuilt once per player instead of
  once per validation run. An earlier attempt to fix this by
  pre-warming weekly-sage-schedule's HTTP cache still timed out,
  since it relied on Netlify response caching working a specific
  way that could not be confirmed. This eliminates the redundant
  work directly instead: the schedule map is built exactly once,
  below, and passed by reference into every in-process
  buildPlayerSeason() call -- no HTTP self-fetch, no serialization,
  for either the schedule map or the per-player evidence itself.

  weekly-sage-player-season.js's own exports.handler (its GET HTTP
  contract, used by every other existing caller) is unmodified.
*/
const {
  buildPriorWeekScheduleMap,
  buildPlayerSeason
} = require(
  "./weekly-sage-player-season.js"
);

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

/*
  Keep downstream player-season evidence-building controlled.

  A full Week 8 TE population is typically smaller than WR,
  so we do not build all outcomes simultaneously.
*/
const DEFAULT_CONCURRENCY =
  5;

const MAX_CONCURRENCY =
  10;

function num(
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
    : 0;
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
  digits = 3
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

async function fetchJsonWithStatus(
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

  return {
    ok:
      response.ok,

    status:
      response.status,

    data
  };
}

async function fetchJson(
  url
) {
  const result =
    await fetchJsonWithStatus(
      url
    );

  if (
    !result.ok
  ) {
    const rawDetail =
      result.data &&
      (
        result.data.detail ||
        result.data.error
      )
        ? (
            result.data.detail ||
            result.data.error
          )
        : null;

    let message;

    if (
      typeof rawDetail ===
      "string"
    ) {
      /*
        Unchanged from before: a string detail/error is used exactly
        as-is, with no HTTP status prefix added.
      */
      message =
        rawDetail;
    } else if (
      rawDetail &&
      typeof rawDetail ===
        "object"
    ) {
      /*
        FIX: previously `new Error(rawDetail)` coerced an
        object/array detail (e.g. weekly-sage-te-leaderboard's
        {blobStore, blobKey, problems: [...]} diagnostic body) via
        the default Object.prototype.toString(), producing the
        literal, useless string "[object Object]". Serialize it
        safely instead, with the HTTP status folded in since a raw
        JSON blob alone doesn't otherwise convey why it's an error.
      */
      let serialized;

      try {
        serialized =
          JSON.stringify(
            rawDetail
          );
      } catch (
        stringifyError
      ) {
        serialized =
          String(
            rawDetail
          );
      }

      message =
        `HTTP ${result.status}: ${serialized}`;
    } else {
      /*
        Unchanged from before: no detail/error at all.
      */
      message =
        `HTTP ${result.status}`;
    }

    throw new Error(
      message
    );
  }

  return result.data;
}

function errorMessage(
  result
) {
  if (
    !result
  ) {
    return (
      "Unknown outcome retrieval failure."
    );
  }

  const data =
    result.data ||
    {};

  return (
    data.detail ||
    data.error ||
    `HTTP ${result.status}`
  );
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

async function fetchLeaderboard({
  baseUrl,
  season,
  week,
  seasonType
}) {
  const url =
    buildUrl({
      baseUrl,

      functionName:
        LEADERBOARD_FUNCTION,

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
      "weekly-sage-te-leaderboard"
  ) {
    throw new Error(
      "Unexpected Weekly SAGE TE leaderboard schema."
    );
  }

  return data;
}

/*
  To observe the actual target-week game while preserving
  no-look-ahead:

    Prediction targetWeek = 8
    Outcome evidence week = 9

  buildPlayerSeason(targetWeek=9) contains games
  from Weeks 1 through 8.

  We extract ONLY Week 8.

  This calls buildPlayerSeason() directly, in-process --
  weekly-sage-player-season.js's core computation is required()
  above, not fetched over HTTP. The shared scheduleContext (built
  exactly once for this whole validation run -- see the call site
  below, right before the per-player fan-out) is passed straight
  through, so buildPlayerSeason() skips its own internal
  buildPriorWeekScheduleMap() call entirely for every one of these
  calls. No HTTP self-fetch and no serialization happen here at all;
  scheduleContext is the same JS Map, shared by reference.

  Any failure -- including a genuine "player not found" -- throws
  here rather than returning an {ok:false} shape. mapWithConcurrency's
  own worker() below already catches any thrown mapper() error and
  converts it into the same {ok:false, status, data:{error}} shape
  this function used to return directly over HTTP, so the existing
  failure-handling loop downstream needs no changes.
*/
async function fetchPlayerOutcomeSource({
  baseUrl,
  season,
  targetWeek,
  seasonType,
  playerID,
  scheduleContext
}) {
  const outcomeEvidenceWeek =
    targetWeek +
    1;

  const data =
    await buildPlayerSeason({
      baseUrl,
      season,

      targetWeek:
        outcomeEvidenceWeek,

      seasonType,
      playerID,
      scheduleContext
    });

  return {
    ok:
      true,

    status:
      200,

    data
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

          status:
            500,

          data: {
            error:
              error &&
              error.message
                ? error.message
                : String(
                    error
                  )
          }
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

function gameWeek(
  game
) {
  if (
    !game ||
    typeof game !==
      "object"
  ) {
    return null;
  }

  const value =
    game.week ??
    game.gameWeek ??
    game.weekNumber;

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

function findTargetGame(
  playerSeason,
  targetWeek
) {
  const games =
    Array.isArray(
      playerSeason &&
      playerSeason.sourceGames
    )
      ? playerSeason.sourceGames
      : [];

  return (
    games.find(
      function (
        game
      ) {
        return (
          gameWeek(
            game
          ) ===
          targetWeek
        );
      }
    ) ||
    null
  );
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
      game[
        name
      ] &&
      typeof game[
        name
      ] ===
        "object"
    ) {
      return game[
        name
      ];
    }
  }

  return {};
}

function actualStats(
  game
) {
  const passing =
    statBlock(
      game,
      "Passing",
      "passing"
    );

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

  const passYards =
    num(
      passing.passYds ??
      passing.passingYards ??
      passing.yards
    );

  const passTD =
    num(
      passing.passTD ??
      passing.passingTD ??
      passing.touchdowns
    );

  const interceptions =
    num(
      passing.int ??
      passing.interceptions ??
      passing.passInt
    );

  const carries =
    num(
      rushing.carries ??
      rushing.rushAttempts ??
      rushing.attempts
    );

  const rushYards =
    num(
      rushing.rushYds ??
      rushing.rushingYards ??
      rushing.yards
    );

  const rushTD =
    num(
      rushing.rushTD ??
      rushing.rushingTD ??
      rushing.touchdowns
    );

  const targets =
    num(
      receiving.targets ??
      receiving.recTargets
    );

  const receptions =
    num(
      receiving.receptions ??
      receiving.rec ??
      receiving.catches
    );

  const recYards =
    num(
      receiving.recYds ??
      receiving.receivingYards ??
      receiving.yards
    );

  const recTD =
    num(
      receiving.recTD ??
      receiving.receivingTD ??
      receiving.touchdowns
    );

  return {
    passing: {
      yards:
        passYards,

      touchdowns:
        passTD,

      interceptions
    },

    rushing: {
      carries,

      yards:
        rushYards,

      touchdowns:
        rushTD
    },

    receiving: {
      targets,

      receptions,

      yards:
        recYards,

      touchdowns:
        recTD
    },

    scrimmage: {
      touches:
        carries +
        receptions,

      opportunities:
        carries +
        targets,

      yards:
        rushYards +
        recYards,

      touchdowns:
        rushTD +
        recTD
    }
  };
}

/*
  Generic validation scoring.

  Standard:
    Passing yard     0.04
    Passing TD       4
    INT             -2
    Rushing yard     0.10
    Rushing TD       6
    Receiving yard   0.10
    Receiving TD     6
    Reception        0

  Half-PPR:
    Same + 0.5 per reception

  PPR:
    Same + 1.0 per reception

  Fumbles and league-specific bonuses are intentionally
  excluded from this validation layer.
*/
function fantasyPoints(
  stats
) {
  const passingPoints =
    (
      stats
        .passing
        .yards *
      0.04
    ) +
    (
      stats
        .passing
        .touchdowns *
      4
    ) -
    (
      stats
        .passing
        .interceptions *
      2
    );

  const rushingPoints =
    (
      stats
        .rushing
        .yards *
      0.1
    ) +
    (
      stats
        .rushing
        .touchdowns *
      6
    );

  const receivingPoints =
    (
      stats
        .receiving
        .yards *
      0.1
    ) +
    (
      stats
        .receiving
        .touchdowns *
      6
    );

  const standard =
    passingPoints +
    rushingPoints +
    receivingPoints;

  return {
    standard:
      round(
        standard,
        2
      ),

    halfPPR:
      round(
        standard +
        (
          stats
            .receiving
            .receptions *
          0.5
        ),
        2
      ),

    ppr:
      round(
        standard +
        stats
          .receiving
          .receptions,
        2
      )
  };
}

function actualOutcome({
  game,
  player
}) {
  const stats =
    actualStats(
      game
    );

  return {
    playerID:
      player.playerID,

    name:
      player.name,

    team:
      player.team,

    opponent:
      player.opponent,

    game: {
      gameID:
        game.gameID ||
        null,

      week:
        gameWeek(
          game
        ),

      gameDate:
        game.gameDate ||
        null,

      gameStatus:
        game.gameStatus ||
        null
    },

    stats,

    fantasyPoints:
      fantasyPoints(
        stats
      )
  };
}

function validationRecord({
  player,
  outcome
}) {
  return {
    playerID:
      player.playerID,

    name:
      player.name,

    team:
      player.team,

    currentTeam:
      player.currentTeam ||
      null,

    opponent:
      player.opponent ||
      null,

    sageRank:
      nullableNum(
        player.rank
      ),

    sageScore:
      nullableNum(
        player.sageScore
      ),

    sageLabel:
      player.sageLabel ||
      null,

    sageConfidence:
      nullableNum(
        player.sageConfidence
      ),

    components: {
      role:
        nullableNum(
          player.role &&
          player.role.adjustedScore
        ),

      production:
        nullableNum(
          player.production &&
          player.production.adjustedScore
        ),

      matchup:
        nullableNum(
          player.matchup &&
          player.matchup.adjustedScore
        )
    },

    actual: {
      fantasyPoints:
        outcome.fantasyPoints,

      targets:
        outcome.stats
          .receiving
          .targets,

      receptions:
        outcome.stats
          .receiving
          .receptions,

      receivingYards:
        outcome.stats
          .receiving
          .yards,

      receivingTD:
        outcome.stats
          .receiving
          .touchdowns,

      carries:
        outcome.stats
          .rushing
          .carries,

      rushingYards:
        outcome.stats
          .rushing
          .yards,

      rushingTD:
        outcome.stats
          .rushing
          .touchdowns,

      scrimmageYards:
        outcome.stats
          .scrimmage
          .yards,

      opportunities:
        outcome.stats
          .scrimmage
          .opportunities,

      totalTD:
        outcome.stats
          .scrimmage
          .touchdowns
    },

    actualRank:
      null,

    rankDifference:
      null,

    targetGame:
      outcome.game
  };
}

/*
  Competition ranking.

  Equal fantasy-point totals receive the same actual rank.

  Example:

    20.0 -> rank 1
    18.0 -> rank 2
    18.0 -> rank 2
    16.0 -> rank 4
*/
function rankActual(
  records,
  scoringKey
) {
  const sorted =
    [
      ...records
    ].sort(
      function (
        a,
        b
      ) {
        const aPoints =
          nullableNum(
            a.actual &&
            a.actual
              .fantasyPoints &&
            a.actual
              .fantasyPoints[
                scoringKey
              ]
          );

        const bPoints =
          nullableNum(
            b.actual &&
            b.actual
              .fantasyPoints &&
            b.actual
              .fantasyPoints[
                scoringKey
              ]
          );

        if (
          aPoints ===
            null &&
          bPoints ===
            null
        ) {
          return 0;
        }

        if (
          aPoints ===
          null
        ) {
          return 1;
        }

        if (
          bPoints ===
          null
        ) {
          return -1;
        }

        return (
          bPoints -
          aPoints
        );
      }
    );

  const ranks =
    new Map();

  let previousPoints =
    null;

  let previousRank =
    0;

  sorted.forEach(
    function (
      player,
      index
    ) {
      const points =
        nullableNum(
          player.actual &&
          player.actual
            .fantasyPoints &&
          player.actual
            .fantasyPoints[
              scoringKey
            ]
        );

      if (
        index ===
          0 ||
        points !==
          previousPoints
      ) {
        previousRank =
          index +
          1;
      }

      ranks.set(
        player.playerID,
        previousRank
      );

      previousPoints =
        points;
    }
  );

  return ranks;
}

function addActualRanks(
  validation
) {
  const standardRanks =
    rankActual(
      validation,
      "standard"
    );

  const halfPPRRanks =
    rankActual(
      validation,
      "halfPPR"
    );

  const pprRanks =
    rankActual(
      validation,
      "ppr"
    );

  for (
    const record of
    validation
  ) {
    const standard =
      standardRanks.get(
        record.playerID
      ) ||
      null;

    const halfPPR =
      halfPPRRanks.get(
        record.playerID
      ) ||
      null;

    const ppr =
      pprRanks.get(
        record.playerID
      ) ||
      null;

    record.actualRank = {
      standard,

      halfPPR,

      ppr
    };

    record.rankDifference = {
      standard:
        (
          record.sageRank !==
            null &&
          standard !==
            null
        )
          ? (
              record.sageRank -
              standard
            )
          : null,

      halfPPR:
        (
          record.sageRank !==
            null &&
          halfPPR !==
            null
        )
          ? (
              record.sageRank -
              halfPPR
            )
          : null,

      ppr:
        (
          record.sageRank !==
            null &&
          ppr !==
            null
        )
          ? (
              record.sageRank -
              ppr
            )
          : null
    };
  }
}

function pearsonArrays(
  xs,
  ys
) {
  if (
    xs.length !==
      ys.length ||
    xs.length <
      2
  ) {
    return null;
  }

  const meanX =
    xs.reduce(
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
    ) /
    xs.length;

  const meanY =
    ys.reduce(
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
    ) /
    ys.length;

  let numerator =
    0;

  let denominatorX =
    0;

  let denominatorY =
    0;

  for (
    let i = 0;
    i <
    xs.length;
    i += 1
  ) {
    const dx =
      xs[
        i
      ] -
      meanX;

    const dy =
      ys[
        i
      ] -
      meanY;

    numerator +=
      dx *
      dy;

    denominatorX +=
      dx *
      dx;

    denominatorY +=
      dy *
      dy;
  }

  const denominator =
    Math.sqrt(
      denominatorX *
      denominatorY
    );

  if (
    denominator ===
    0
  ) {
    return null;
  }

  return (
    numerator /
    denominator
  );
}

function pairedCorrelation(
  records,
  xAccessor,
  yAccessor
) {
  const xs =
    [];

  const ys =
    [];

  for (
    const record of
    records
  ) {
    const x =
      nullableNum(
        xAccessor(
          record
        )
      );

    const y =
      nullableNum(
        yAccessor(
          record
        )
      );

    if (
      x ===
        null ||
      y ===
        null
    ) {
      continue;
    }

    xs.push(
      x
    );

    ys.push(
      y
    );
  }

  if (
    xs.length <
    2
  ) {
    return null;
  }

  const value =
    pearsonArrays(
      xs,
      ys
    );

  return value ===
    null
    ? null
    : round(
        value,
        3
      );
}

/*
  Average ranks used for Spearman.

  Ties receive the average of their occupied ranks.
*/
function averageRanks(
  values
) {
  const indexed =
    values.map(
      function (
        value,
        index
      ) {
        return {
          value,
          index
        };
      }
    );

  indexed.sort(
    function (
      a,
      b
    ) {
      return (
        a.value -
        b.value
      );
    }
  );

  const ranks =
    new Array(
      values.length
    );

  let i =
    0;

  while (
    i <
    indexed.length
  ) {
    let j =
      i +
      1;

    while (
      j <
        indexed.length &&
      indexed[
        j
      ].value ===
        indexed[
          i
        ].value
    ) {
      j +=
        1;
    }

    const averageRank =
      (
        (
          i +
          1
        ) +
        j
      ) /
      2;

    for (
      let k = i;
      k <
      j;
      k +=
        1
    ) {
      ranks[
        indexed[
          k
        ].index
      ] =
        averageRank;
    }

    i =
      j;
  }

  return ranks;
}

function spearmanScoreVsOutcome(
  records,
  scoringKey
) {
  const sageValues =
    [];

  const actualValues =
    [];

  for (
    const record of
    records
  ) {
    const sage =
      nullableNum(
        record.sageScore
      );

    const actual =
      nullableNum(
        record.actual &&
        record.actual
          .fantasyPoints &&
        record.actual
          .fantasyPoints[
            scoringKey
          ]
      );

    if (
      sage ===
        null ||
      actual ===
        null
    ) {
      continue;
    }

    sageValues.push(
      sage
    );

    actualValues.push(
      actual
    );
  }

  if (
    sageValues.length <
    2
  ) {
    return null;
  }

  const sageRanks =
    averageRanks(
      sageValues
    );

  const actualRanks =
    averageRanks(
      actualValues
    );

  const correlation =
    pearsonArrays(
      sageRanks,
      actualRanks
    );

  return correlation ===
    null
    ? null
    : round(
        correlation,
        3
      );
}

/*
  Direct rank correlation.

  Lower rank numbers are better for both SAGE and actual outcome,
  so a positive correlation still means the rankings broadly agree.
*/
function sageRankVsActualRankCorrelation(
  records,
  scoringKey
) {
  return pairedCorrelation(
    records,

    function (
      record
    ) {
      return (
        record.sageRank
      );
    },

    function (
      record
    ) {
      return (
        record.actualRank &&
        record.actualRank[
          scoringKey
        ]
      );
    }
  );
}

function fantasyPointCorrelation(
  records,
  scoringKey,
  xAccessor
) {
  return pairedCorrelation(
    records,

    xAccessor,

    function (
      record
    ) {
      return (
        record.actual &&
        record.actual
          .fantasyPoints &&
        record.actual
          .fantasyPoints[
            scoringKey
          ]
      );
    }
  );
}

function buildCorrelations(
  validation
) {
  const result =
    {};

  for (
    const scoringKey of
    [
      "standard",
      "halfPPR",
      "ppr"
    ]
  ) {
    result[
      scoringKey
    ] = {
      sageVsFantasyPoints: {
        pearson:
          fantasyPointCorrelation(
            validation,
            scoringKey,
            function (
              record
            ) {
              return (
                record.sageScore
              );
            }
          ),

        spearman:
          spearmanScoreVsOutcome(
            validation,
            scoringKey
          )
      },

      sageRankVsActualRank:
        sageRankVsActualRankCorrelation(
          validation,
          scoringKey
        ),

      componentVsFantasyPoints: {
        role:
          fantasyPointCorrelation(
            validation,
            scoringKey,
            function (
              record
            ) {
              return (
                record.components &&
                record.components.role
              );
            }
          ),

        production:
          fantasyPointCorrelation(
            validation,
            scoringKey,
            function (
              record
            ) {
              return (
                record.components &&
                record.components.production
              );
            }
          ),

        matchup:
          fantasyPointCorrelation(
            validation,
            scoringKey,
            function (
              record
            ) {
              return (
                record.components &&
                record.components.matchup
              );
            }
          )
      }
    };
  }

  return result;
}

function topCapture({
  leaderboardPlayers,
  validation,
  scoringKey,
  topN
}) {
  /*
    Predicted set is frozen from the ORIGINAL pre-game leaderboard.

    We do not remove DNP players before selecting predicted Top N,
    because doing so after the game would introduce hindsight.

    Actual Top N is determined only from players who actually played.
  */
  const predicted =
    leaderboardPlayers
      .filter(
        function (
          player
        ) {
          return (
            nullableNum(
              player.rank
            ) !==
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
            a.rank -
            b.rank
          );
        }
      )
      .slice(
        0,
        topN
      );

  const actual =
    validation
      .filter(
        function (
          record
        ) {
          return (
            record.actualRank &&
            nullableNum(
              record.actualRank[
                scoringKey
              ]
            ) !==
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
            a.actualRank[
              scoringKey
            ] -
            b.actualRank[
              scoringKey
            ]
          );
        }
      )
      .slice(
        0,
        Math.min(
          topN,
          validation.length
        )
      );

  const predictedIDs =
    new Set(
      predicted.map(
        function (
          player
        ) {
          return (
            String(
              player.playerID
            )
          );
        }
      )
    );

  const captured =
    actual.filter(
      function (
        record
      ) {
        return (
          predictedIDs.has(
            String(
              record.playerID
            )
          )
        );
      }
    );

  const actualCount =
    actual.length;

  return {
    topN,

    predictedPlayers:
      predicted.length,

    actualPlayers:
      actualCount,

    actualTopNCaptured:
      captured.length,

    hitRate:
      actualCount >
        0
        ? round(
            captured.length /
            actualCount,
            3
          )
        : null,

    hitPercent:
      actualCount >
        0
        ? round(
            (
              captured.length /
              actualCount
            ) *
            100,
            1
          )
        : null,

    capturedPlayers:
      captured.map(
        function (
          record
        ) {
          return {
            playerID:
              record.playerID,

            name:
              record.name,

            sageRank:
              record.sageRank,

            actualRank:
              record.actualRank[
                scoringKey
              ]
          };
        }
      )
  };
}

function buildTopCapture(
  leaderboardPlayers,
  validation
) {
  const output =
    {};

  for (
    const scoringKey of
    [
      "standard",
      "halfPPR",
      "ppr"
    ]
  ) {
    output[
      scoringKey
    ] = {
      top12:
        topCapture({
          leaderboardPlayers,
          validation,
          scoringKey,
          topN:
            12
        }),

      top24:
        topCapture({
          leaderboardPlayers,
          validation,
          scoringKey,
          topN:
            24
        }),

      top36:
        topCapture({
          leaderboardPlayers,
          validation,
          scoringKey,
          topN:
            36
        })
    };
  }

  return output;
}

function averageFantasyPoints(
  records,
  scoringKey
) {
  const values =
    records
      .map(
        function (
          record
        ) {
          return nullableNum(
            record.actual &&
            record.actual
              .fantasyPoints &&
            record.actual
              .fantasyPoints[
                scoringKey
              ]
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
      );

  if (
    values.length ===
    0
  ) {
    return null;
  }

  return round(
    values.reduce(
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
    ) /
    values.length,
    2
  );
}

/*
  Diagnostic SAGE bands only.

  These are NOT recommendation thresholds.
*/
function groupBySageBand(
  records
) {
  const definitions = [
    {
      key:
        "85_plus",

      label:
        "85+",

      min:
        85,

      max:
        Infinity
    },

    {
      key:
        "75_to_84_9",

      label:
        "75-84.9",

      min:
        75,

      max:
        84.999999
    },

    {
      key:
        "65_to_74_9",

      label:
        "65-74.9",

      min:
        65,

      max:
        74.999999
    },

    {
      key:
        "55_to_64_9",

      label:
        "55-64.9",

      min:
        55,

      max:
        64.999999
    },

    {
      key:
        "45_to_54_9",

      label:
        "45-54.9",

      min:
        45,

      max:
        54.999999
    },

    {
      key:
        "35_to_44_9",

      label:
        "35-44.9",

      min:
        35,

      max:
        44.999999
    },

    {
      key:
        "below_35",

      label:
        "Below 35",

      min:
        -Infinity,

      max:
        34.999999
    }
  ];

  return definitions.map(
    function (
      definition
    ) {
      const players =
        records.filter(
          function (
            record
          ) {
            const score =
              nullableNum(
                record.sageScore
              );

            return (
              score !==
                null &&
              score >=
                definition.min &&
              score <=
                definition.max
            );
          }
        );

      return {
        key:
          definition.key,

        label:
          definition.label,

        count:
          players.length,

        averageSageScore:
          players.length
            ? round(
                players.reduce(
                  function (
                    sum,
                    player
                  ) {
                    return (
                      sum +
                      player.sageScore
                    );
                  },
                  0
                ) /
                players.length,
                1
              )
            : null,

        averageActualFantasyPoints: {
          standard:
            averageFantasyPoints(
              players,
              "standard"
            ),

          halfPPR:
            averageFantasyPoints(
              players,
              "halfPPR"
            ),

          ppr:
            averageFantasyPoints(
              players,
              "ppr"
            )
        }
      };
    }
  );
}

function dnpRecord(
  player,
  targetWeek
) {
  return {
    playerID:
      player.playerID,

    name:
      player.name,

    predictionTeam:
      player.team ||
      null,

    currentTeam:
      player.currentTeam ||
      null,

    status:
      "did_not_play",

    eligibleForOutcomeValidation:
      false,

    sageRank:
      nullableNum(
        player.rank
      ),

    sageScore:
      nullableNum(
        player.sageScore
      ),

    fantasyPoints:
      null,

    scheduledGame: {
      team:
        player.team ||
        null,

      opponent:
        player.opponent ||
        null,

      location:
        player.location ||
        null,

      gameID:
        player.gameID ||
        null,

      gameDate:
        player.gameDate ||
        null
    },

    reason:
      `Historical team ${player.team || "unknown"} had a Week ${targetWeek} game, but no Week ${targetWeek} player-game record exists in the post-game evidence. Classified as Did Not Play and excluded from validation correlations.`
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

    /*
      Week 18 cannot currently use targetWeek + 1 through the
      existing player-season architecture.

      Historical validation therefore supports Weeks 2-17.
    */
    if (
      !Number.isInteger(
        targetWeek
      ) ||
      targetWeek <
        2 ||
      targetWeek >
        17
    ) {
      return jsonResponse(
        400,
        {
          error:
            "week must be an integer from 2 through 17."
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

    try {
      const baseUrl =
        getBaseUrl(
          event
        );

      /*
        STEP 1
        ------
        Retrieve the frozen PRE-GAME Weekly SAGE TE leaderboard.

        This is the prediction side of validation.
      */
      const leaderboard =
        await fetchLeaderboard({
          baseUrl,
          season,
          week:
            targetWeek,
          seasonType
        });

      const activePlayers =
        Array.isArray(
          leaderboard.leaderboard
        )
          ? leaderboard.leaderboard
          : [];

      const byePlayers =
        Array.isArray(
          leaderboard.inactive
        )
          ? leaderboard.inactive
          : [];

      const leaderboardUnresolved =
        Array.isArray(
          leaderboard.unresolved
        )
          ? leaderboard.unresolved
          : [];

      const leaderboardFailures =
        Array.isArray(
          leaderboard.failures
        )
          ? leaderboard.failures
          : [];

      if (
        activePlayers.length ===
        0
      ) {
        return jsonResponse(
          422,
          {
            error:
              "Weekly SAGE TE leaderboard contains no active TEs."
          }
        );
      }

      /*
        We do not validate an already-dirty forecast population.

        If the leaderboard itself had unresolved players or scoring
        failures, historical interpretation should wait.
      */
      if (
        leaderboardUnresolved.length >
          0 ||
        leaderboardFailures.length >
          0
      ) {
        return jsonResponse(
          422,
          {
            error:
              "Weekly SAGE TE leaderboard is not clean enough for historical validation.",

            unresolvedPlayers:
              leaderboardUnresolved.length,

            leaderboardFailures:
              leaderboardFailures.length
          }
        );
      }

      /*
        STEP 1.5
        --------
        Build the shared prior-week schedule map ONCE, in-process,
        before the per-player fan-out below. This is the same
        buildPriorWeekScheduleMap() weekly-sage-player-season.js
        already used internally -- required directly from that file
        (see the top of this file), not called over HTTP. Every
        active TE's evidence call below reuses this exact same Map
        object by reference; none of them rebuild it.

        targetWeek + 1 matches player-season's own internal
        targetWeek convention (its schedule map covers Weeks 1
        through its own targetWeek - 1, i.e. Weeks 1 through this
        validation's targetWeek) -- the same arithmetic
        fetchPlayerOutcomeSource() below already uses.
      */
      const scheduleContext =
        await buildPriorWeekScheduleMap({
          baseUrl,
          season,

          targetWeek:
            targetWeek +
            1,

          seasonType
        });

      /*
        STEP 2
        ------
        Retrieve POST-GAME target-week player evidence.

        Example:
          targetWeek 8
          -> player-season targetWeek 9
          -> extract ONLY Week 8

        Controlled concurrency keeps this from building the entire
        TE universe's evidence simultaneously. No HTTP self-fetch
        happens here anymore -- fetchPlayerOutcomeSource() below
        calls buildPlayerSeason() in-process for each player,
        reusing the single scheduleContext built just above.
      */
      const outcomeResults =
        await mapWithConcurrency(
          activePlayers,
          concurrency,
          function (
            player
          ) {
            return fetchPlayerOutcomeSource({
              baseUrl,
              season,
              targetWeek,
              seasonType,
              scheduleContext,

              playerID:
                player.playerID
            });
          }
        );

      const validation =
        [];

      const didNotPlay =
        [];

      const failures =
        [];

      for (
        let index = 0;
        index <
          outcomeResults.length;
        index +=
          1
      ) {
        const result =
          outcomeResults[
            index
          ];

        const player =
          activePlayers[
            index
          ];

        if (
          !result ||
          !result.ok
        ) {
          failures.push({
            playerID:
              player.playerID,

            name:
              player.name,

            team:
              player.team,

            status:
              "failure",

            error:
              errorMessage(
                result
              )
          });

          continue;
        }

        const game =
          findTargetGame(
            result.data,
            targetWeek
          );

        /*
          The leaderboard has already established that this
          historical team had a scheduled target-week game.

          Therefore:
            schedule says ACTIVE
            +
            no player-game record
            =
            DID NOT PLAY

          Never convert this to zero fantasy points.
        */
        if (
          !game
        ) {
          didNotPlay.push(
            dnpRecord(
              player,
              targetWeek
            )
          );

          continue;
        }

        const outcome =
          actualOutcome({
            game,
            player
          });

        validation.push(
          validationRecord({
            player,
            outcome
          })
        );
      }

      /*
        STEP 3
        ------
        Add actual TE finish ranks in all three scoring systems.
      */
      addActualRanks(
        validation
      );

      /*
        Preserve original pre-game SAGE ordering in the output.
      */
      validation.sort(
        function (
          a,
          b
        ) {
          return (
            a.sageRank -
            b.sageRank
          );
        }
      );

      /*
        STEP 4
        ------
        Measure the untouched TE SAGE v1 forecast.

        No weight changes occur here.
      */
      const correlations =
        buildCorrelations(
          validation
        );

      const topCapture =
        buildTopCapture(
          activePlayers,
          validation
        );

      const scoreBands =
        groupBySageBand(
          validation
        );

      const ready =
        validation.length >
          0 &&
        failures.length ===
          0;

      return jsonResponse(
        200,
        {
          evidenceType:
            "weekly-sage-te-validation",

          schemaVersion:
            1,

          generatedAt:
            new Date()
              .toISOString(),

          season,

          targetWeek,

          seasonType,

          methodology: {
            modelVersion:
              "te-sage-v1",

            prediction:
              `Weekly SAGE TE Week ${targetWeek} scores generated using only evidence available before Week ${targetWeek}.`,

            outcome:
              `Actual Week ${targetWeek} games extracted from player-season evidence queried with targetWeek=${targetWeek + 1}.`,

            leakageProtection:
              "Target-week actual results are retrieved only after the frozen pre-game SAGE leaderboard. Actual results never alter historical Role, Production, Matchup, Confidence, or SAGE scores.",

            participationHandling:
              "Leaderboard bye players remain excluded. Active-team TEs with a target-week player-game record are classified as played. Active-team TEs with no target-week player-game record are classified as Did Not Play and are never assigned zero fantasy points.",

            participationStates: [
              "played",
              "bye",
              "did_not_play",
              "failure"
            ],

            fantasyScoring: {
              standard: {
                passingYards:
                  0.04,

                passingTD:
                  4,

                interception:
                  -2,

                rushingYards:
                  0.1,

                rushingTD:
                  6,

                receivingYards:
                  0.1,

                receivingTD:
                  6,

                reception:
                  0
              },

              halfPPR: {
                reception:
                  0.5,

                otherwise:
                  "Same as Standard"
              },

              ppr: {
                reception:
                  1,

                otherwise:
                  "Same as Standard"
              }
            },

            componentValidation:
              "Role, Production, and Matchup are correlated independently against actual fantasy points so their relative predictive signal can be inspected before weight sensitivity testing.",

            topCapture:
              "Predicted Top 12/24/36 sets are frozen from the original pre-game leaderboard. Actual Top 12/24/36 sets are calculated from WRs who actually played. DNP players are not removed from the frozen predicted sets after the fact.",

            exclusions: [
              "Fumble penalties",
              "League-specific yardage bonuses",
              "League-specific first-down scoring"
            ],

            important:
              "This endpoint measures the untouched provisional TE SAGE v1 model (55/40/5 placeholder). It does not optimize weights or create recommendation thresholds."
          },

          population: {
            sageSnapshotPlayers:
              leaderboard.population &&
              leaderboard.population
                .snapshotPlayersReturned !==
                undefined
                ? leaderboard.population
                    .snapshotPlayersReturned
                : null,

            sageActivePlayers:
              activePlayers.length,

            outcomesMatched:
              validation.length,

            byeExcluded:
              byePlayers.length,

            didNotPlayExcluded:
              didNotPlay.length,

            failures:
              failures.length,

            concurrency
          },

          correlations,

          topCapture,

          scoreBands,

          validation,

          bye:
            byePlayers,

          didNotPlay,

          failures,

          recommendationThresholds:
            null,

          nextStep: {
            ready,

            reason:
              ready
                ? "The frozen TE SAGE forecast has been matched to actual target-week outcomes. Review overall correlations, component correlations, rank agreement, Top-12/24/36 capture, and score-band behavior before changing TE weights."
                : "Resolve outcome retrieval failures before interpreting TE forecast-vs-actual validation."
          },

          architecture: {
            modelVersion:
              "te-sage-v1",

            predictionSource:
              LEADERBOARD_FUNCTION,

            outcomeSource:
              PLAYER_SEASON_FUNCTION,

            predictionRecalculatedAfterOutcome:
              false,

            directTank01Calls:
              0
          },

          provenance: {
            prediction:
              LEADERBOARD_FUNCTION,

            rawRoleAndProduction:
              "weekly-sage-te-component-scores",

            confidence:
              "weekly-sage-te-confidence",

            matchup:
              "weekly-sage-player-matchup",

            outcomeEvidence:
              PLAYER_SEASON_FUNCTION,

            participation:
              LEADERBOARD_FUNCTION,

            outcomeWeekExtraction:
              `Week ${targetWeek} source game only`
          }
        },

        CACHE_CONTROL
      );
    } catch (
      error
    ) {
      console.error(
        "weekly-sage-te-validation failed:",
        error
      );

      return jsonResponse(
        502,
        {
          error:
            "Could not validate Weekly SAGE TE scores against actual outcomes.",

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
