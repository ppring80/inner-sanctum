// netlify/functions/weekly-sage-rb-benchmarks.js
//
// WEEKLY SAGE — RB POSITIONAL BENCHMARKS
//
// PURPOSE
// -------
// Build a no-look-ahead peer population of NFL running backs and
// benchmark a target RB against that population.
//
// IMPORTANT
// ---------
// This is a DIAGNOSTIC / BENCHMARK layer.
//
// It DOES NOT:
// - calculate the final SAGE score
// - create START/SIT recommendations
// - modify weekly-sage-player-assessment
// - invent fixed "elite/good/bad" thresholds
//
// Instead:
//
//   1. Get the target RB's validated player-season evidence.
//   2. Discover RB peers from Tank01 getNFLPlayerList.
//   3. Build the same no-look-ahead player-season evidence for each peer.
//   4. Apply a minimum-sample / meaningful-usage population filter.
//   5. Calculate percentile ranks for Role and Production metrics.
//   6. Return the full population so we can inspect it before scoring.
//
// ═══════════════════════════════════════════════════════════════════════

const TANK01_HOST =
  "tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com";

const DEFAULT_SEASON_TYPE = "reg";

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

const MIN_GAMES = 2;
const MIN_OPPORTUNITIES_PER_GAME = 5;

const CONCURRENCY = 6;

const PLAYER_SEASON_FUNCTION =
  "weekly-sage-player-season";

function num(value) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : 0;
}

function round(value, digits = 2) {
  const factor =
    Math.pow(10, digits);

  return (
    Math.round(
      (
        num(value) +
        Number.EPSILON
      ) *
      factor
    ) / factor
  );
}

function normalizePosition(value) {
  return String(
    value || ""
  )
    .trim()
    .toUpperCase();
}

function normalizeTeam(value) {
  return String(
    value || ""
  )
    .trim()
    .toUpperCase();
}

function tank01Headers() {
  return {
    "Content-Type":
      "application/json",

    "x-rapidapi-host":
      TANK01_HOST,

    "x-rapidapi-key":
      process.env.TANK01_API_KEY
  };
}

async function tank01Fetch(
  endpoint,
  params
) {
  const query =
    new URLSearchParams(
      params || {}
    ).toString();

  const url =
    `https://${TANK01_HOST}/${endpoint}` +
    (query ? `?${query}` : "");

  const response =
    await fetch(
      url,
      {
        method: "GET",
        headers:
          tank01Headers()
      }
    );

  let data = null;

  try {
    data =
      await response.json();
  } catch (error) {
    data = null;
  }

  if (!response.ok) {
    let detail =
      `HTTP ${response.status}`;

    if (
      data &&
      data.message
    ) {
      detail =
        data.message;
    } else if (
      data &&
      data.error
    ) {
      detail =
        data.error;
    } else if (
      data &&
      typeof data.body === "string"
    ) {
      detail =
        data.body;
    }

    throw new Error(
      `Tank01 ${endpoint} failed: ${detail}`
    );
  }

  return data;
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

async function fetchJson(url) {
  const response =
    await fetch(
      url,
      {
        method: "GET",

        headers: {
          Accept:
            "application/json"
        }
      }
    );

  let data = null;

  try {
    data =
      await response.json();
  } catch (error) {
    data = null;
  }

  if (!response.ok) {
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

    throw new Error(detail);
  }

  return data;
}

function unwrapBody(data) {
  if (
    data &&
    typeof data === "object" &&
    Object.prototype.hasOwnProperty.call(
      data,
      "body"
    )
  ) {
    let body =
      data.body;

    if (
      typeof body === "string"
    ) {
      try {
        body =
          JSON.parse(body);
      } catch (error) {
        // Leave unchanged.
      }
    }

    return body;
  }

  return data;
}

function extractPlayers(data) {
  const body =
    unwrapBody(data);

  if (Array.isArray(body)) {
    return body;
  }

  if (
    body &&
    Array.isArray(body.players)
  ) {
    return body.players;
  }

  if (
    body &&
    Array.isArray(body.body)
  ) {
    return body.body;
  }

  if (
    data &&
    Array.isArray(data.players)
  ) {
    return data.players;
  }

  return [];
}

function playerIDOf(player) {
  return String(
    player.playerID ??
    player.playerId ??
    player.id ??
    ""
  ).trim();
}

function playerNameOf(player) {
  return (
    player.longName ??
    player.name ??
    player.playerName ??
    null
  );
}

function playerTeamOf(player) {
  return normalizeTeam(
    player.team ??
    player.teamAbv ??
    player.teamAbbr ??
    ""
  );
}

function playerPositionOf(player) {
  return normalizePosition(
    player.pos ??
    player.position ??
    player.positionAbv ??
    ""
  );
}

function percentileRank(
  values,
  target
) {
  const clean =
    values.filter(
      value =>
        Number.isFinite(
          Number(value)
        )
    );

  if (!clean.length) {
    return null;
  }

  const targetNumber =
    Number(target);

  if (
    !Number.isFinite(
      targetNumber
    )
  ) {
    return null;
  }

  let below = 0;
  let equal = 0;

  for (
    const rawValue
    of clean
  ) {
    const value =
      Number(rawValue);

    if (
      value < targetNumber
    ) {
      below += 1;
    } else if (
      value === targetNumber
    ) {
      equal += 1;
    }
  }

  return round(
    (
      (
        below +
        0.5 * equal
      ) /
      clean.length
    ) *
    100,
    1
  );
}

function distributionPercentile(
  values,
  percentile
) {
  const clean =
    values
      .map(Number)
      .filter(
        Number.isFinite
      )
      .sort(
        (a, b) =>
          a - b
      );

  if (!clean.length) {
    return null;
  }

  if (
    clean.length === 1
  ) {
    return round(
      clean[0]
    );
  }

  const p =
    Math.max(
      0,
      Math.min(
        1,
        percentile
      )
    );

  const index =
    (
      clean.length -
      1
    ) *
    p;

  const lower =
    Math.floor(index);

  const upper =
    Math.ceil(index);

  if (
    lower === upper
  ) {
    return round(
      clean[lower]
    );
  }

  const weight =
    index - lower;

  return round(
    clean[lower] +
    weight *
    (
      clean[upper] -
      clean[lower]
    )
  );
}

function describeDistribution(
  values
) {
  const clean =
    values
      .map(Number)
      .filter(
        Number.isFinite
      );

  if (!clean.length) {
    return {
      count: 0,
      min: null,
      p25: null,
      median: null,
      p75: null,
      p90: null,
      max: null
    };
  }

  return {
    count:
      clean.length,

    min:
      round(
        Math.min(
          ...clean
        )
      ),

    p25:
      distributionPercentile(
        clean,
        0.25
      ),

    median:
      distributionPercentile(
        clean,
        0.50
      ),

    p75:
      distributionPercentile(
        clean,
        0.75
      ),

    p90:
      distributionPercentile(
        clean,
        0.90
      ),

    max:
      round(
        Math.max(
          ...clean
        )
      )
  };
}

// ═══════════════════════════════════════════════════════════════════════
// TANK01 PLAYER LIST
//
// RapidAPI documents this endpoint as:
//
//   /getNFLPlayerList?all=true
//
// "all=true" is REQUIRED for the full player population.
// ═══════════════════════════════════════════════════════════════════════

async function fetchPlayerList() {
  if (
    !process.env.TANK01_API_KEY
  ) {
    throw new Error(
      "TANK01_API_KEY is not configured."
    );
  }

  const data =
    await tank01Fetch(
      "getNFLPlayerList",
      {
        all: "true"
      }
    );

  const players =
    extractPlayers(data);

  if (!players.length) {
    throw new Error(
      "Tank01 getNFLPlayerList returned no players."
    );
  }

  return players;
}

async function fetchPlayerSeason({
  baseUrl,
  season,
  week,
  playerID,
  seasonType
}) {
  const url =
    `${baseUrl}/.netlify/functions/${PLAYER_SEASON_FUNCTION}` +
    `?season=${encodeURIComponent(season)}` +
    `&week=${encodeURIComponent(week)}` +
    `&playerID=${encodeURIComponent(playerID)}` +
    `&seasonType=${encodeURIComponent(seasonType)}`;

  const data =
    await fetchJson(url);

  if (
    !data ||
    data.evidenceType !==
      "weekly-sage-player-season"
  ) {
    throw new Error(
      "Unexpected player-season evidence schema."
    );
  }

  return data;
}

function buildRBRecord(
  evidence
) {
  const player =
    evidence.player ||
    {};

  const usage =
    evidence.usageProfile ||
    {};

  const perGame =
    evidence.perGame ||
    {};

  const rushing =
    perGame.rushing ||
    {};

  const receiving =
    perGame.receiving ||
    {};

  const carriesPerGame =
    num(
      usage.carriesPerGame ??
      rushing.carriesPerGame
    );

  const targetsPerGame =
    num(
      usage.targetsPerGame ??
      receiving.targetsPerGame
    );

  const receptionsPerGame =
    num(
      usage.receptionsPerGame ??
      receiving.receptionsPerGame
    );

  const rushingYardsPerGame =
    num(
      usage.rushYardsPerGame ??
      rushing.yardsPerGame
    );

  const receivingYardsPerGame =
    num(
      usage.receivingYardsPerGame ??
      receiving.yardsPerGame
    );

  const rushingTDPerGame =
    num(
      usage.rushTDPerGame ??
      rushing.touchdownsPerGame
    );

  const receivingTDPerGame =
    num(
      receiving.touchdownsPerGame
    );

  return {
    playerID:
      String(
        player.playerID ||
        ""
      ),

    name:
      player.name ||
      null,

    team:
      normalizeTeam(
        player.team
      ),

    position:
      normalizePosition(
        player.position
      ),

    gamesUsed:
      num(
        evidence.gamesUsed
      ),

    weeksIncluded:
      evidence.noLookAhead &&
      Array.isArray(
        evidence
          .noLookAhead
          .weeksIncluded
      )
        ? evidence
            .noLookAhead
            .weeksIncluded
        : [],

    role: {
      carriesPerGame,

      targetsPerGame,

      receptionsPerGame,

      opportunitiesPerGame:
        round(
          carriesPerGame +
          targetsPerGame
        ),

      offensiveSnapPct:
        num(
          usage.offensiveSnapPct
        )
    },

    production: {
      rushingYardsPerGame,

      yardsPerCarry:
        num(
          usage.yardsPerCarry ??
          rushing.yardsPerCarry
        ),

      rushingTDPerGame,

      receivingYardsPerGame,

      receivingTDPerGame,

      scrimmageYardsPerGame:
        round(
          rushingYardsPerGame +
          receivingYardsPerGame
        ),

      totalTDPerGame:
        round(
          rushingTDPerGame +
          receivingTDPerGame
        )
    }
  };
}

function populationEligible(
  record
) {
  if (
    record.position !== "RB"
  ) {
    return false;
  }

  if (
    record.gamesUsed <
    MIN_GAMES
  ) {
    return false;
  }

  if (
    record.role
      .opportunitiesPerGame <
    MIN_OPPORTUNITIES_PER_GAME
  ) {
    return false;
  }

  return true;
}

async function mapWithConcurrency(
  items,
  limit,
  worker
) {
  const results =
    new Array(
      items.length
    );

  let nextIndex = 0;

  async function runWorker() {
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
          await worker(
            items[index],
            index
          );
      } catch (error) {
        results[index] = {
          ok: false,
          error:
            error.message,
          item:
            items[index]
        };
      }
    }
  }

  const workers = [];

  const workerCount =
    Math.min(
      limit,
      items.length
    );

  for (
    let i = 0;
    i < workerCount;
    i += 1
  ) {
    workers.push(
      runWorker()
    );
  }

  await Promise.all(
    workers
  );

  return results;
}

function metricValues(
  population,
  section,
  metric
) {
  return population
    .map(
      player =>
        player[section]
          ? player[section][metric]
          : null
    )
    .filter(
      value =>
        Number.isFinite(
          Number(value)
        )
    )
    .map(Number);
}

function buildMetricBenchmark({
  population,
  target,
  section,
  metric
}) {
  const values =
    metricValues(
      population,
      section,
      metric
    );

  const value =
    target &&
    target[section]
      ? num(
          target[section][metric]
        )
      : 0;

  return {
    value,

    percentile:
      percentileRank(
        values,
        value
      ),

    distribution:
      describeDistribution(
        values
      )
  };
}

function buildTargetBenchmarks(
  population,
  target
) {
  return {
    role: {
      carriesPerGame:
        buildMetricBenchmark({
          population,
          target,
          section:
            "role",
          metric:
            "carriesPerGame"
        }),

      targetsPerGame:
        buildMetricBenchmark({
          population,
          target,
          section:
            "role",
          metric:
            "targetsPerGame"
        }),

      receptionsPerGame:
        buildMetricBenchmark({
          population,
          target,
          section:
            "role",
          metric:
            "receptionsPerGame"
        }),

      opportunitiesPerGame:
        buildMetricBenchmark({
          population,
          target,
          section:
            "role",
          metric:
            "opportunitiesPerGame"
        }),

      offensiveSnapPct:
        buildMetricBenchmark({
          population,
          target,
          section:
            "role",
          metric:
            "offensiveSnapPct"
        })
    },

    production: {
      rushingYardsPerGame:
        buildMetricBenchmark({
          population,
          target,
          section:
            "production",
          metric:
            "rushingYardsPerGame"
        }),

      yardsPerCarry:
        buildMetricBenchmark({
          population,
          target,
          section:
            "production",
          metric:
            "yardsPerCarry"
        }),

      rushingTDPerGame:
        buildMetricBenchmark({
          population,
          target,
          section:
            "production",
          metric:
            "rushingTDPerGame"
        }),

      receivingYardsPerGame:
        buildMetricBenchmark({
          population,
          target,
          section:
            "production",
          metric:
            "receivingYardsPerGame"
        }),

      receivingTDPerGame:
        buildMetricBenchmark({
          population,
          target,
          section:
            "production",
          metric:
            "receivingTDPerGame"
        }),

      scrimmageYardsPerGame:
        buildMetricBenchmark({
          population,
          target,
          section:
            "production",
          metric:
            "scrimmageYardsPerGame"
        }),

      totalTDPerGame:
        buildMetricBenchmark({
          population,
          target,
          section:
            "production",
          metric:
            "totalTDPerGame"
        })
    }
  };
}

function sortPopulation(
  population
) {
  return [
    ...population
  ].sort(
    (a, b) => {
      const opportunityDiff =
        b.role
          .opportunitiesPerGame -
        a.role
          .opportunitiesPerGame;

      if (
        opportunityDiff !== 0
      ) {
        return opportunityDiff;
      }

      return (
        b.production
          .scrimmageYardsPerGame -
        a.production
          .scrimmageYardsPerGame
      );
    }
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
  async function (event) {
    if (
      event.httpMethod &&
      event.httpMethod !== "GET"
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

    const week =
      Number(
        query.week
      );

    const playerID =
      String(
        query.playerID ||
        ""
      ).trim();

    const seasonType =
      String(
        query.seasonType ||
        DEFAULT_SEASON_TYPE
      );

    if (
      !Number.isInteger(
        week
      ) ||
      week < 2 ||
      week > 18
    ) {
      return jsonResponse(
        400,
        {
          error:
            "week must be an integer from 2 through 18 for positional benchmarking."
        }
      );
    }

    if (!playerID) {
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
        getBaseUrl(event);

      const targetEvidence =
        await fetchPlayerSeason({
          baseUrl,
          season,
          week,
          playerID,
          seasonType
        });

      const targetPosition =
        normalizePosition(
          targetEvidence.player &&
          targetEvidence.player.position
        );

      if (
        targetPosition !== "RB"
      ) {
        return jsonResponse(
          400,
          {
            error:
              "Step 7A currently supports RB benchmarking only.",

            player:
              targetEvidence.player
          }
        );
      }

      const allPlayers =
        await fetchPlayerList();

      const rbCandidates =
        allPlayers
          .filter(
            player =>
              playerPositionOf(
                player
              ) === "RB"
          )
          .map(
            player => ({
              playerID:
                playerIDOf(
                  player
                ),

              name:
                playerNameOf(
                  player
                ),

              team:
                playerTeamOf(
                  player
                )
            })
          )
          .filter(
            player =>
              player.playerID
          );

      const uniqueMap =
        new Map();

      for (
        const player
        of rbCandidates
      ) {
        if (
          !uniqueMap.has(
            player.playerID
          )
        ) {
          uniqueMap.set(
            player.playerID,
            player
          );
        }
      }

      const uniqueCandidates =
        [
          ...uniqueMap.values()
        ];

      const peerResults =
        await mapWithConcurrency(
          uniqueCandidates,
          CONCURRENCY,
          async candidate => {
            try {
              const evidence =
                candidate.playerID ===
                playerID
                  ? targetEvidence
                  : await fetchPlayerSeason({
                      baseUrl,
                      season,
                      week,
                      playerID:
                        candidate.playerID,
                      seasonType
                    });

              const record =
                buildRBRecord(
                  evidence
                );

              return {
                ok: true,
                candidate,
                record
              };
            } catch (error) {
              return {
                ok: false,
                candidate,
                error:
                  error.message
              };
            }
          }
        );

      const successful =
        peerResults.filter(
          result =>
            result &&
            result.ok &&
            result.record
        );

      const failed =
        peerResults.filter(
          result =>
            !result ||
            !result.ok
        );

      const allRBRecords =
        successful.map(
          result =>
            result.record
        );

      const population =
        allRBRecords.filter(
          populationEligible
        );

      const target =
        population.find(
          player =>
            player.playerID ===
            playerID
        );

      const rawTarget =
        buildRBRecord(
          targetEvidence
        );

      if (!target) {
        return jsonResponse(
          422,
          {
            error:
              "Target RB does not meet the current benchmark population eligibility rules.",

            target:
              rawTarget,

            populationRules: {
              position:
                "RB",

              minimumGames:
                MIN_GAMES,

              minimumOpportunitiesPerGame:
                MIN_OPPORTUNITIES_PER_GAME
            },

            diagnostic: {
              candidatesDiscovered:
                uniqueCandidates.length,

              playerSeasonResponses:
                successful.length,

              eligiblePopulation:
                population.length,

              failures:
                failed.length
            }
          }
        );
      }

      const benchmarks =
        buildTargetBenchmarks(
          population,
          target
        );

      const sortedPopulation =
        sortPopulation(
          population
        );

      const targetPopulationIndex =
        sortedPopulation.findIndex(
          player =>
            player.playerID ===
            playerID
        );

      return jsonResponse(
        200,
        {
          evidenceType:
            "weekly-sage-rb-benchmarks",

          schemaVersion:
            1,

          generatedAt:
            new Date()
              .toISOString(),

          season,

          targetWeek:
            week,

          seasonType,

          noLookAhead: {
            rule:
              `Only player evidence before Week ${week} is used.`,

            targetWeekExcluded:
              true,

            source:
              PLAYER_SEASON_FUNCTION
          },

          methodology: {
            position:
              "RB",

            populationDefinition:
              "Running backs with sufficient prior-game evidence and meaningful offensive opportunity entering the target week.",

            populationRules: {
              minimumGames:
                MIN_GAMES,

              minimumOpportunitiesPerGame:
                MIN_OPPORTUNITIES_PER_GAME
            },

            percentileMethod:
              "midrank",

            percentileFormula:
              "((players below + 0.5 * players tied) / population size) * 100",

            important:
              "These percentiles describe the peer population. They are not yet the final SAGE Role Score or Production Score."
          },

          populationSummary: {
            nflPlayersReturned:
              allPlayers.length,

            rbCandidatesDiscovered:
              uniqueCandidates.length,

            playerSeasonResponses:
              successful.length,

            playerSeasonFailures:
              failed.length,

            rbRecordsWithEvidence:
              allRBRecords.length,

            eligibleRBPopulation:
              population.length
          },

          target: {
            ...target,

            populationRankByOpportunities:
              targetPopulationIndex >= 0
                ? targetPopulationIndex + 1
                : null,

            populationSize:
              population.length
          },

          benchmarks,

          population:
            sortedPopulation,

          failures:
            failed
              .slice(
                0,
                25
              )
              .map(
                result => ({
                  playerID:
                    result &&
                    result.candidate
                      ? result
                          .candidate
                          .playerID
                      : null,

                  name:
                    result &&
                    result.candidate
                      ? result
                          .candidate
                          .name
                      : null,

                  error:
                    result
                      ? result.error
                      : "Unknown failure"
                })
              ),

          nextStep: {
            roleScore:
              null,

            productionScore:
              null,

            finalSageScore:
              null,

            reason:
              "Validate the RB peer population and metric distributions before assigning component weights."
          }
        },

        CACHE_CONTROL
      );
    } catch (error) {
      console.error(
        "weekly-sage-rb-benchmarks failed:",
        error
      );

      return jsonResponse(
        502,
        {
          error:
            "Could not build Weekly SAGE RB benchmarks.",

          detail:
            error.message
        }
      );
    }
  };
