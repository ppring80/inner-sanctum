// netlify/functions/weekly-sage-qb-component-scores.js
//
// WEEKLY SAGE — QB COMPONENT SCORES
//
// PURPOSE
// -------
// Convert QB benchmark percentiles into the first-pass raw
// Weekly SAGE Role Score and Production Score.
//
// SOURCE
// ------
//
//   weekly-sage-qb-benchmarks
//
// QB ROLE FORMULA — V1 HYPOTHESIS
// -------------------------------
//
//   Pass Attempts per Game       55%
//   Rush Attempts per Game       30%
//   Offensive Snap %             15%
//
// QB PRODUCTION FORMULA — V1 HYPOTHESIS
// -------------------------------------
//
//   Passing Yards/Game           25%
//   Passing TD/Game              25%
//   Rushing Yards/Game           20%
//   Rushing TD/Game              15%
//   Yards/Attempt                10%
//   Interceptions/Game            5%
//
// NOTE ON INTERCEPTIONS
// ---------------------
// weekly-sage-qb-benchmarks.js already inverts the interceptions-per-game
// percentile so that fewer interceptions = a higher/better percentile.
// Therefore the component layer can use a normal positive 5% weight.
//
// IMPORTANT
// ---------
// These are provisional QB component formulas.
//
// They are NOT final model weights.
//
// We will validate these component scores across contrasting QB
// archetypes before defining:
//
//   - confidence adjustment
//   - matchup influence
//   - final QB SAGE composition
//   - START / FLEX / SIT recommendations
//
// WHY THESE METRICS?
// ------------------
// Role measures how much weekly offensive opportunity a QB controls.
//
// Production measures how effectively a QB turns that opportunity into fantasy production.
//
// QB efficiency and ball-security evidence remain inside the Production formula.
// Completion percentage is intentionally excluded from v1 because it can be
// heavily scheme-dependent and less directly tied to fantasy production.
//
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_SEASON_TYPE =
  "reg";

const POSITION =
  "QB";

const BENCHMARK_FUNCTION =
  "weekly-sage-qb-benchmarks";

/*
  weekly-sage-qb-benchmarks's core computation (buildQbBenchmarks) is
  required directly, in-process, rather than invoked over HTTP (see
  fetchBenchmarks() below, now unused but left in place for
  reference). This lets an optional prebuilt snapshot be forwarded
  down to it by reference -- no serialization, no self-fetch.
*/
const {
  buildQbBenchmarks
} = require(
  "./weekly-sage-qb-benchmarks.js"
);

function statusError(
  status,
  body
) {
  const err =
    new Error(
      (
        body &&
        body.error
      ) ||
      "Request failed."
    );

  err.status =
    status;

  err.body =
    body;

  return err;
}

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

/*
  PROVISIONAL QB V1 STARTING HYPOTHESIS — pending historical validation.

  These internal Role/Production sub-weights are intentionally QB-specific
  and frozen before backtesting. They reflect the agreed football logic:
  passing volume anchors Role, QB rushing receives substantial Role weight,
  and Production balances passing output with fantasy-relevant rushing.

  Do not tune these values in response to individual historical weeks.
  Revisit only after the QB validation/backtest evidence set is complete.
*/
const ROLE_WEIGHTS = {
  passAttemptsPerGame:
    0.55,

  carriesPerGame:
    0.30,

  offensiveSnapPct:
    0.15
};

const PRODUCTION_WEIGHTS = {
  passYardsPerGame:
    0.25,

  passTDPerGame:
    0.25,

  rushingYardsPerGame:
    0.20,

  rushingTDPerGame:
    0.15,

  yardsPerAttempt:
    0.10,

  interceptionsPerGame:
    0.05
};

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

    throw new Error(
      detail
    );
  }

  return data;
}

async function fetchBenchmarks({
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
        BENCHMARK_FUNCTION,

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

  const data =
    await fetchJson(
      url
    );

  if (
    !data ||
    data.evidenceType !==
      "weekly-sage-qb-benchmarks"
  ) {
    throw new Error(
      "Unexpected Weekly SAGE QB benchmark schema."
    );
  }

  return data;
}

function benchmarkPercentile(
  benchmarks,
  section,
  key
) {
  const value =
    benchmarks &&
    benchmarks.benchmarks &&
    benchmarks.benchmarks[
      section
    ] &&
    benchmarks.benchmarks[
      section
    ][
      key
    ]
      ? benchmarks.benchmarks[
          section
        ][
          key
        ].percentile
      : null;

  return nullableNum(
    value
  );
}

function weightedComponent({
  benchmarkData,
  section,
  weights
}) {
  let total =
    0;

  let availableWeight =
    0;

  const evidence =
    {};

  for (
    const [
      key,
      weight
    ] of
    Object.entries(
      weights
    )
  ) {
    const percentile =
      benchmarkPercentile(
        benchmarkData,
        section,
        key
      );

    evidence[
      key
    ] = {
      percentile,

      weight
    };

    if (
      percentile ===
      null
    ) {
      continue;
    }

    total +=
      percentile *
      weight;

    availableWeight +=
      weight;
  }

  if (
    availableWeight ===
    0
  ) {
    return {
      score:
        null,

      availableWeight:
        0,

      evidence
    };
  }

  /*
    Normalize by available weight.

    This protects against an isolated missing metric without
    automatically forcing the component downward.

    In the normal snapshot population all required QB metrics
    should be available, so availableWeight should equal 1.0.
  */
  const normalizedScore =
    total /
    availableWeight;

  return {
    score:
      round(
        normalizedScore,
        1
      ),

    availableWeight:
      round(
        availableWeight,
        3
      ),

    evidence
  };
}

function scoreLabel(
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
    90
  ) {
    return "Elite";
  }

  if (
    value >=
    80
  ) {
    return "Very Strong";
  }

  if (
    value >=
    70
  ) {
    return "Strong";
  }

  if (
    value >=
    60
  ) {
    return "Above Average";
  }

  if (
    value >=
    40
  ) {
    return "Average";
  }

  if (
    value >=
    25
  ) {
    return "Below Average";
  }

  return "Weak";
}

function strongestEvidence(
  evidence
) {
  const rows =
    Object.entries(
      evidence ||
      {}
    )
      .map(
        function ([
          key,
          row
        ]) {
          return {
            key,

            percentile:
              nullableNum(
                row &&
                row.percentile
              ),

            weight:
              nullableNum(
                row &&
                row.weight
              )
          };
        }
      )
      .filter(
        function (
          row
        ) {
          return (
            row.percentile !==
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
            b.percentile -
            a.percentile
          );
        }
      );

  return (
    rows.length
      ? rows[0]
      : null
  );
}

function weakestEvidence(
  evidence
) {
  const rows =
    Object.entries(
      evidence ||
      {}
    )
      .map(
        function ([
          key,
          row
        ]) {
          return {
            key,

            percentile:
              nullableNum(
                row &&
                row.percentile
              ),

            weight:
              nullableNum(
                row &&
                row.weight
              )
          };
        }
      )
      .filter(
        function (
          row
        ) {
          return (
            row.percentile !==
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
            a.percentile -
            b.percentile
          );
        }
      );

  return (
    rows.length
      ? rows[0]
      : null
  );
}

function buildExplanation({
  player,
  role,
  production
}) {
  const name =
    player &&
    player.name
      ? player.name
      : "Player";

  return (
    `${name} has a raw QB Role Score of ${role.score} ` +
    `and a raw QB Production Score of ${production.score}. ` +
    `Role emphasizes passing volume, rushing involvement and offensive snaps, ` +
    `while Production emphasizes passing yardage and touchdowns, rushing output, ` +
    `passing efficiency and ball security.`
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

    const playerID =
      String(
        query.playerID ||
        ""
      ).trim();

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
      !playerID
    ) {
      return jsonResponse(
        400,
        {
          error:
            "playerID is required."
        }
      );
    }

    try {
      const baseUrl =
        getBaseUrl(
          event
        );

      const body =
        await buildQbComponentScores({
          baseUrl,
          season,
          targetWeek,
          seasonType,
          playerID
        });

      return jsonResponse(
        200,
        body,
        CACHE_CONTROL
      );
    } catch (
      error
    ) {
      if (
        typeof error.status ===
        "number"
      ) {
        return jsonResponse(
          error.status,
          error.body
        );
      }

      console.error(
        "weekly-sage-qb-component-scores failed:",
        error
      );

      return jsonResponse(
        502,
        {
          error:
            "Could not calculate Weekly SAGE QB component scores.",

          detail:
            error.message
        }
      );
    }
  };

/*
  Core Weekly SAGE QB component-score computation.
  exports.handler above is a thin HTTP wrapper around this function.
  Mirrors weekly-sage-qb-benchmarks.js's statusError()/prebuiltSnapshot
  pattern so the downstream leaderboard can reuse one snapshot in-process.

  prebuiltSnapshot is OPTIONAL and forwarded straight through to
  buildQbBenchmarks() -- this function does not use it directly
  itself, only passes it one layer further down the chain.
*/
async function buildQbComponentScores({
  baseUrl,
  season,
  targetWeek,
  seasonType,
  playerID,
  prebuiltSnapshot
}) {
  /*
    STEP 1
    ------
    Fetch peer-relative QB benchmark evidence.

    No direct Tank01 calls occur here.
  */
  const benchmarks =
    await buildQbBenchmarks({
      baseUrl,
      season,
      targetWeek,
      seasonType,
      playerID,
      prebuiltSnapshot
    });

  const player =
    benchmarks.player ||
    {};

  if (
    player.position !==
    POSITION
  ) {
    throw statusError(
      400,
      {
        error:
          "QB component scoring requires a QB.",

        playerID,

        position:
          player.position ||
          null
      }
    );
  }

  /*
    STEP 2
    ------
    Build provisional raw Role and Production scores from
    the benchmark percentiles.
  */
  const role =
    weightedComponent({
      benchmarkData:
        benchmarks,

      section:
        "role",

      weights:
        ROLE_WEIGHTS
    });

  const production =
    weightedComponent({
      benchmarkData:
        benchmarks,

      section:
        "production",

      weights:
        PRODUCTION_WEIGHTS
    });

  if (
    role.score ===
      null ||
    production.score ===
      null
  ) {
    throw statusError(
      422,
      {
        error:
          "One or more QB components could not be calculated.",

        role,

        production
      }
    );
  }

  return {
    evidenceType:
      "weekly-sage-qb-component-scores",

    schemaVersion:
      1,

    generatedAt:
      new Date()
        .toISOString(),

    season,

    targetWeek,

    seasonType,

    player: {
      playerID:
        player.playerID ||
        playerID,

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

      gamesUsed:
        player.gamesUsed ||
        null,

      weeksIncluded:
        player.weeksIncluded ||
        []
    },

    noLookAhead:
      benchmarks.noLookAhead ||
      null,

    methodology: {
      position:
        POSITION,

      status:
        "First-pass provisional QB component methodology.",

      roleWeights:
        ROLE_WEIGHTS,

      productionWeights:
        PRODUCTION_WEIGHTS,

      rolePhilosophy:
        "Role measures how much weekly offensive opportunity the QB controls through passing volume, rushing involvement and snaps.",

      productionPhilosophy:
        "Production measures how effectively the QB converts opportunity into fantasy-relevant passing and rushing production while accounting for interceptions through the benchmark direction.",

      excludedFromFirstPassRoleFormula:
        [],

      excludedFromFirstPassProductionFormula:
        [],

      important:
        "These are raw QB Role and Production scores only. They are not confidence-adjusted and are not yet combined into a final SAGE score."
    },

    components: {
      role: {
        rawScore:
          role.score,

        label:
          scoreLabel(
            role.score
          ),

        availableWeight:
          role.availableWeight,

        weights:
          ROLE_WEIGHTS,

        evidence:
          role.evidence,

        strongestEvidence:
          strongestEvidence(
            role.evidence
          ),

        weakestEvidence:
          weakestEvidence(
            role.evidence
          )
      },

      production: {
        rawScore:
          production.score,

        label:
          scoreLabel(
            production.score
          ),

        availableWeight:
          production.availableWeight,

        weights:
          PRODUCTION_WEIGHTS,

        evidence:
          production.evidence,

        strongestEvidence:
          strongestEvidence(
            production.evidence
          ),

        weakestEvidence:
          weakestEvidence(
            production.evidence
          )
      }
    },

    explanation:
      buildExplanation({
        player,
        role,
        production
      }),

    recommendation:
      null,

    nextStep: {
      ready:
        true,

      reason:
        "Compare raw QB Role and Production scores across contrasting quarterback profiles before designing QB confidence adjustment or final SAGE composition."
    },

    architecture: {
      populationSource:
        "weekly-sage-qb-snapshot",

      benchmarkSource:
        "weekly-sage-qb-benchmarks",

      populationRebuiltForThisPlayer:
        false,

      directTank01Calls:
        0
    },

    provenance: {
      peerPopulation:
        "weekly-sage-qb-snapshot",

      benchmarkPercentiles:
        "weekly-sage-qb-benchmarks",

      roleFormula:
        ROLE_WEIGHTS,

      productionFormula:
        PRODUCTION_WEIGHTS
    }
  };
}

exports.buildQbComponentScores =
  buildQbComponentScores;
