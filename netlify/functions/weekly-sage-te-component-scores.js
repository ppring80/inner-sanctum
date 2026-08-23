// netlify/functions/weekly-sage-te-component-scores.js
//
// WEEKLY SAGE — TE COMPONENT SCORES
//
// PURPOSE
// -------
// Convert TE benchmark percentiles into the first-pass raw
// Weekly SAGE Role Score and Production Score.
//
// SOURCE
// ------
//
//   weekly-sage-te-benchmarks
//
// FIRST-PASS TE ROLE FORMULA
// --------------------------
//
//   Targets per Game          45%
//   Opportunities per Game    25%
//   Offensive Snap %          20%
//   Receptions per Game       10%
//
// FIRST-PASS TE PRODUCTION FORMULA
// --------------------------------
//
//   Scrimmage Yards/Game      45%
//   Receiving Yards/Game      25%
//   Total TD/Game             20%
//   Yards/Target              10%
//
// IMPORTANT
// ---------
// These are provisional TE component formulas.
//
// They are NOT final model weights.
//
// We will validate these component scores across contrasting TE
// archetypes before defining:
//
//   - confidence adjustment
//   - matchup influence
//   - final TE SAGE composition
//   - START / FLEX / SIT recommendations
//
// WHY THESE METRICS?
// ------------------
// Role measures how strongly a TE is earning and holding opportunity.
//
// Production measures what the TE is turning that opportunity into.
//
// Efficiency metrics such as yards per reception and catch rate remain
// diagnostic evidence but are intentionally excluded from the first-pass
// formulas because they are more dependent on receiver archetype, route
// depth and offensive usage.
//
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_SEASON_TYPE =
  "reg";

const POSITION =
  "TE";

const BENCHMARK_FUNCTION =
  "weekly-sage-te-benchmarks";

/*
  weekly-sage-te-benchmarks's core computation (buildTeBenchmarks) is
  required directly, in-process, rather than invoked over HTTP (see
  fetchBenchmarks() below, now unused but left in place for
  reference). This lets an optional prebuilt snapshot be forwarded
  down to it by reference -- no serialization, no self-fetch.
*/
const {
  buildTeBenchmarks
} = require(
  "./weekly-sage-te-benchmarks.js"
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
  PROVISIONAL STARTING HYPOTHESIS — pending TE historical validation.

  These internal Role/Production sub-weights are copied verbatim from
  weekly-sage-wr-component-scores.js. Unlike the eligibility threshold
  in weekly-sage-te-snapshot.js (a structural adjustment for how TEs
  are used, justifiable without data), these sub-weights are exactly
  the kind of decision that genuinely requires historical evidence to
  set correctly -- WR's own values were not guessed, and neither
  should TE's be. There is no TE backtest yet, so the honest starting
  point is "no evidence yet to justify anything different from WR,"
  not an invented TE-specific number. Revisit once
  weekly-sage-te-backtest.js exists and has real weeks of data.
*/
const ROLE_WEIGHTS = {
  targetsPerGame:
    0.45,

  opportunitiesPerGame:
    0.25,

  offensiveSnapPct:
    0.20,

  receptionsPerGame:
    0.10
};

const PRODUCTION_WEIGHTS = {
  scrimmageYardsPerGame:
    0.45,

  receivingYardsPerGame:
    0.25,

  totalTDPerGame:
    0.20,

  yardsPerTarget:
    0.10
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
      "weekly-sage-te-benchmarks"
  ) {
    throw new Error(
      "Unexpected Weekly SAGE TE benchmark schema."
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

    In the normal snapshot population all required TE metrics
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
    `${name} has a raw TE Role Score of ${role.score} ` +
    `and a raw TE Production Score of ${production.score}. ` +
    `Role emphasizes target earning and offensive opportunity, ` +
    `while Production emphasizes scrimmage yardage, receiving yardage, ` +
    `touchdown production and secondary efficiency.`
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
        await buildTeComponentScores({
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
        "weekly-sage-te-component-scores failed:",
        error
      );

      return jsonResponse(
        502,
        {
          error:
            "Could not calculate Weekly SAGE TE component scores.",

          detail:
            error.message
        }
      );
    }
  };

/*
  Core Weekly SAGE TE component-score computation, extracted
  additively. exports.handler above is now a thin wrapper around
  this function and produces byte-identical GET output to before
  this extraction. Mirrors weekly-sage-te-benchmarks.js's own
  statusError()/prebuiltSnapshot pattern exactly.

  prebuiltSnapshot is OPTIONAL and forwarded straight through to
  buildTeBenchmarks() -- this function does not use it directly
  itself, only passes it one layer further down the chain.
*/
async function buildTeComponentScores({
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
        Fetch peer-relative TE benchmark evidence.

        No direct Tank01 calls occur here.
      */
      const benchmarks =
        await buildTeBenchmarks({
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
              "TE component scoring requires a TE.",

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
              "One or more TE components could not be calculated.",

            role,

            production
          }
        );
      }

      return {
          evidenceType:
            "weekly-sage-te-component-scores",

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
              "First-pass provisional TE component methodology.",

            roleWeights:
              ROLE_WEIGHTS,

            productionWeights:
              PRODUCTION_WEIGHTS,

            rolePhilosophy:
              "Role measures how strongly a TE is earning and holding offensive opportunity.",

            productionPhilosophy:
              "Production measures how effectively the TE converts that opportunity into yardage and touchdowns.",

            excludedFromFirstPassRoleFormula: [
              "carriesPerGame"
            ],

            excludedFromFirstPassProductionFormula: [
              "yardsPerReception",
              "catchRate",
              "rushingYardsPerGame",
              "rushingTDPerGame"
            ],

            important:
              "These are raw TE Role and Production scores only. They are not confidence-adjusted and are not yet combined into a final SAGE score."
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
              "Compare raw TE Role and Production scores across contrasting receiver profiles before designing TE confidence adjustment or final SAGE composition."
          },

          architecture: {
            populationSource:
              "weekly-sage-te-snapshot",

            benchmarkSource:
              "weekly-sage-te-benchmarks",

            populationRebuiltForThisPlayer:
              false,

            directTank01Calls:
              0
          },

          provenance: {
            peerPopulation:
              "weekly-sage-te-snapshot",

            benchmarkPercentiles:
              "weekly-sage-te-benchmarks",

            roleFormula:
              ROLE_WEIGHTS,

            productionFormula:
              PRODUCTION_WEIGHTS
          }
        };
}

exports.buildTeComponentScores =
  buildTeComponentScores;
