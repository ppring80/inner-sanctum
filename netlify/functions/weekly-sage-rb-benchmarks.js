// netlify/functions/weekly-sage-rb-benchmarks.js
//
// WEEKLY SAGE — RB POSITIONAL BENCHMARKS
//
// PURPOSE
// -------
// Consume the reusable weekly RB snapshot:
//
//   weekly-sage-rb-snapshot
//
// and benchmark one target RB against that population.
//
// IMPORTANT
// ---------
// This function DOES NOT:
// - call Tank01
// - rebuild the RB population
// - calculate the final SAGE score
// - create START / FLEX / SIT recommendations
//
// ARCHITECTURE
// ------------
//
// weekly-sage-rb-snapshot
//          ↓
// cached weekly RB peer population
//          ↓
// weekly-sage-rb-benchmarks
//          ↓
// target-player percentiles
//
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_SEASON_TYPE =
  "reg";

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

const SNAPSHOT_FUNCTION =
  "weekly-sage-rb-snapshot";

function num(value) {
  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : 0;
}

function round(
  value,
  digits = 2
) {
  const factor =
    Math.pow(
      10,
      digits
    );

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

    throw new Error(
      detail
    );
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
    `${baseUrl}/.netlify/functions/${SNAPSHOT_FUNCTION}` +
    `?season=${encodeURIComponent(season)}` +
    `&week=${encodeURIComponent(week)}` +
    `&seasonType=${encodeURIComponent(seasonType)}`;

  const data =
    await fetchJson(
      url
    );

  if (
    !data ||
    data.evidenceType !==
      "weekly-sage-rb-snapshot"
  ) {
    throw new Error(
      "Unexpected RB snapshot schema."
    );
  }

  return data;
}

/*
  Midrank percentile.

  Ties receive identical treatment.
*/
function percentileRank(
  values,
  target
) {
  const clean =
    values
      .map(Number)
      .filter(
        Number.isFinite
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
    const value
    of clean
  ) {
    if (
      value <
      targetNumber
    ) {
      below += 1;
    } else if (
      value ===
      targetNumber
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

function metricValues(
  population,
  section,
  metric
) {
  return population
    .map(
      player =>
        player &&
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
        num(
          b.role &&
          b.role.opportunitiesPerGame
        ) -
        num(
          a.role &&
          a.role.opportunitiesPerGame
        );

      if (
        opportunityDiff !== 0
      ) {
        return opportunityDiff;
      }

      return (
        num(
          b.production &&
          b.production
            .scrimmageYardsPerGame
        ) -
        num(
          a.production &&
          a.production
            .scrimmageYardsPerGame
        )
      );
    }
  );
}

function normalizeName(value) {
  return String(
    value || ""
  )
    .trim()
    .toLowerCase()
    .replace(
      /[^a-z0-9]/g,
      ""
    );
}

function findTarget(
  population,
  playerID,
  playerName
) {
  /*
    First choice:
    exact Tank01 playerID.
  */
  const byID =
    population.find(
      player =>
        String(
          player.playerID ||
          ""
        ) ===
        String(
          playerID ||
          ""
        )
    );

  if (byID) {
    return {
      target:
        byID,

      resolution:
        "playerID"
    };
  }

  /*
    Optional fallback:
    normalized player name.

    Useful during historical testing when the Tank01 player-list
    representation is inconsistent.
  */
  if (playerName) {
    const normalizedTarget =
      normalizeName(
        playerName
      );

    const byName =
      population.find(
        player =>
          normalizeName(
            player.name
          ) ===
          normalizedTarget
      );

    if (byName) {
      return {
        target:
          byName,

        resolution:
          "name"
      };
    }
  }

  return {
    target:
      null,

    resolution:
      null
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

function benchmarkError(
  statusCode,
  message,
  details = {}
) {
  const error =
    new Error(message);

  error.statusCode =
    statusCode;

  error.responseBody = {
    error:
      message,

    ...details
  };

  return error;
}

async function buildRbBenchmarks({
  season,
  week,
  seasonType = DEFAULT_SEASON_TYPE,
  playerID = "",
  playerName = "",
  prebuiltSnapshot = null,
  baseUrl = null
}) {
  const normalizedSeason =
    String(
      season ||
      new Date()
        .getFullYear()
    );

  const normalizedWeek =
    Number(week);

  const normalizedPlayerID =
    String(
      playerID ||
      ""
    ).trim();

  const normalizedPlayerName =
    String(
      playerName ||
      ""
    ).trim();

  const normalizedSeasonType =
    String(
      seasonType ||
      DEFAULT_SEASON_TYPE
    );

  if (
    !Number.isInteger(
      normalizedWeek
    ) ||
    normalizedWeek < 2 ||
    normalizedWeek > 18
  ) {
    throw benchmarkError(
      400,
      "week must be an integer from 2 through 18."
    );
  }

  if (
    !normalizedPlayerID &&
    !normalizedPlayerName
  ) {
    throw benchmarkError(
      400,
      "playerID or playerName is required."
    );
  }

  let snapshot =
    prebuiltSnapshot;

  if (!snapshot) {
    if (!baseUrl) {
      throw new Error(
        "baseUrl is required when prebuiltSnapshot is not provided."
      );
    }

    /*
      Diagnostic HTTP path only.

      Production callers can pass prebuiltSnapshot and bypass this
      network request entirely.
    */
    snapshot =
      await fetchSnapshot({
        baseUrl,
        season:
          normalizedSeason,
        week:
          normalizedWeek,
        seasonType:
          normalizedSeasonType
      });
  }

  if (
    !snapshot ||
    snapshot.evidenceType !==
      "weekly-sage-rb-snapshot"
  ) {
    throw new Error(
      "Unexpected RB snapshot schema."
    );
  }

  const population =
    Array.isArray(
      snapshot.population
    )
      ? snapshot.population
      : [];

  if (!population.length) {
    throw benchmarkError(
      422,
      "RB snapshot contains no eligible peer population.",
      {
        snapshotKey:
          snapshot.snapshotKey ||
          null
      }
    );
  }

  const sortedPopulation =
    sortPopulation(
      population
    );

  const resolved =
    findTarget(
      sortedPopulation,
      normalizedPlayerID,
      normalizedPlayerName
    );

  const target =
    resolved.target;

  if (!target) {
    throw benchmarkError(
      404,
      "Target RB was not found in the cached eligible RB snapshot.",
      {
        playerID:
          normalizedPlayerID ||
          null,

        playerName:
          normalizedPlayerName ||
          null,

        snapshotKey:
          snapshot.snapshotKey ||
          null,

        populationSize:
          sortedPopulation.length,

        note:
          "The target may be absent from Tank01 getNFLPlayerList or may not meet current RB snapshot eligibility rules."
      }
    );
  }

  const benchmarks =
    buildTargetBenchmarks(
      sortedPopulation,
      target
    );

  const targetPopulationIndex =
    sortedPopulation.findIndex(
      player =>
        String(
          player.playerID
        ) ===
        String(
          target.playerID
        )
    );

  return {
    evidenceType:
      "weekly-sage-rb-benchmarks",

    schemaVersion:
      3,

    generatedAt:
      new Date()
        .toISOString(),

    season:
      normalizedSeason,

    targetWeek:
      normalizedWeek,

    seasonType:
      normalizedSeasonType,

    noLookAhead:
      snapshot.noLookAhead,

    architecture: {
      source:
        "weekly-sage-rb-snapshot",

      snapshotKey:
        snapshot.snapshotKey ||
        null,

      snapshotGeneratedAt:
        snapshot.generatedAt ||
        null,

      tank01CallsFromThisFunction:
        0,

      important:
        "This benchmark request reuses the weekly RB snapshot and does not rebuild the league population."
    },

    methodology: {
      position:
        "RB",

      populationDefinition:
        "Eligible running backs from the cached Weekly SAGE RB snapshot.",

      percentileMethod:
        "midrank",

      percentileFormula:
        "((players below + 0.5 * players tied) / population size) * 100",

      important:
        "These percentiles describe the cached peer population. Role and Production component scoring remains downstream."
    },

    populationSummary: {
      eligibleRBPopulation:
        sortedPopulation.length,

      snapshotCandidates:
        snapshot
          .populationSummary
          ? snapshot
              .populationSummary
              .rbCandidatesDiscovered
          : null,

      snapshotFailures:
        snapshot
          .populationSummary
          ? snapshot
              .populationSummary
              .playerGameFailures
          : null
    },

    targetResolution: {
      requestedPlayerID:
        normalizedPlayerID ||
        null,

      requestedPlayerName:
        normalizedPlayerName ||
        null,

      resolvedBy:
        resolved.resolution,

      resolvedPlayerID:
        target.playerID,

      resolvedName:
        target.name
    },

    target: {
      ...target,

      populationRankByOpportunities:
        targetPopulationIndex >= 0
          ? targetPopulationIndex + 1
          : null,

      populationSize:
        sortedPopulation.length
    },

    benchmarks,

    nextStep: {
      roleScore:
        null,

      productionScore:
        null,

      finalSageScore:
        null,

      reason:
        "Downstream component scoring can now consume this benchmark result without triggering an RB population rebuild."
    },

    provenance: {
      benchmarkPopulation:
        "weekly-sage-rb-snapshot",

      tank01PopulationRebuild:
        false
    }
  };
}

exports.buildRbBenchmarks =
  buildRbBenchmarks;

exports.handler =
  async function (event) {
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

    const week =
      Number(
        query.week
      );

    const playerID =
      String(
        query.playerID ||
        ""
      ).trim();

    const playerName =
      String(
        query.playerName ||
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
            "week must be an integer from 2 through 18."
        }
      );
    }

    if (
      !playerID &&
      !playerName
    ) {
      return jsonResponse(
        400,
        {
          error:
            "playerID or playerName is required."
        }
      );
    }

    try {
      const baseUrl =
        getBaseUrl(event);

      const result =
        await buildRbBenchmarks({
          season,
          week,
          seasonType,
          playerID,
          playerName,
          baseUrl
        });

      return jsonResponse(
        200,
        result,
        CACHE_CONTROL
      );
    } catch (error) {
      if (
        error &&
        error.statusCode
      ) {
        return jsonResponse(
          error.statusCode,
          error.responseBody ||
          {
            error:
              error.message
          }
        );
      }

      console.error(
        "weekly-sage-rb-benchmarks failed:",
        error
      );

      return jsonResponse(
        502,
        {
          error:
            "Could not build Weekly SAGE RB benchmarks from snapshot.",

          detail:
            error.message
        }
      );
    }
  };
