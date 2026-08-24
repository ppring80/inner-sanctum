// netlify/functions/weekly-sage-qb-weight-sensitivity.js
//
// WEEKLY SAGE — QB WEIGHT SENSITIVITY v1
//
// PURPOSE
// -------
// Evaluate alternative Role / Production / Matchup weight combinations
// against the SAME frozen historical QB player-week observations already
// produced by weekly-sage-qb-backtest.
//
// This is a RESEARCH endpoint only.
//
// It DOES NOT:
//   - change qb-sage-v1
//   - change any underlying component score
//   - optimize component formulas
//   - write weights anywhere
//   - create recommendation thresholds
//   - feed actual target-week outcomes back into historical predictions
//
// CONTROL
// -------
//   Role       55%
//   Production 40%
//   Matchup     5%
//
// CACHED HISTORICAL BLOCKS
// ------------------------
//   Weeks 4-7
//   Weeks 8-10
//   Weeks 11-14
//   Weeks 15-17
//
// These four blocks reconstruct the complete practical Weeks 4-17
// historical validation population without rebuilding any historical
// week inside this endpoint.
//
// STORE
// -----
//   qb-backtest
//
// KEYS
// ----
//   block:${season}:4:7:${seasonType}
//   block:${season}:8:10:${seasonType}
//   block:${season}:11:14:${seasonType}
//   block:${season}:15:17:${seasonType}
//
// GRID
// ----
//   Role       20%-70%
//   Production 20%-70%
//   Matchup     0%-20%
//   Step        5%
//   Total       100%
//
// CANDIDATE RANKING
// -----------------
// No opaque optimizer is used.
// Candidates are sorted lexicographically by:
//   1. full-sample Spearman (higher is better)
//   2. worst segment Spearman (higher is better)
//   3. negative-correlation weeks (fewer is better)
//   4. mean weekly Spearman (higher is better)
//   5. full-sample Pearson (higher is better)
//
// ═══════════════════════════════════════════════════════════════════════

const {
  connectLambda,
  getStore
} = require("@netlify/blobs");

const DEFAULT_SEASON_TYPE =
  "reg";

const STORE_NAME =
  "qb-backtest";

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

const CONTROL_WEIGHTS = {
  role: 0.55,
  production: 0.40,
  matchup: 0.05
};

const CONSERVATIVE_CHALLENGER = {
  role: 0.40,
  production: 0.50,
  matchup: 0.10
};

const REFERENCE_GRID_LEADER = {
  role: 0.25,
  production: 0.55,
  matchup: 0.20
};

const CACHED_BLOCKS = [
  {
    key: "early",
    startWeek: 4,
    endWeek: 7
  },
  {
    key: "middle_a",
    startWeek: 8,
    endWeek: 10
  },
  {
    key: "middle_b",
    startWeek: 11,
    endWeek: 14
  },
  {
    key: "late",
    startWeek: 15,
    endWeek: 17
  }
];

const ANALYSIS_SEGMENTS = {
  early: {
    startWeek: 4,
    endWeek: 7
  },
  middle: {
    startWeek: 8,
    endWeek: 14
  },
  late: {
    startWeek: 15,
    endWeek: 17
  }
};

const GRID = {
  roleMin: 0.20,
  roleMax: 0.70,
  productionMin: 0.20,
  productionMax: 0.70,
  matchupMin: 0.00,
  matchupMax: 0.20,
  step: 0.05
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

function blobKey({
  season,
  startWeek,
  endWeek,
  seasonType
}) {
  return (
    `block:${season}:${startWeek}:${endWeek}:${seasonType}`
  );
}

function validateCachedBacktest({
  backtest,
  season,
  startWeek,
  endWeek,
  seasonType
}) {
  const problems =
    [];

  if (
    !backtest ||
    typeof backtest !==
      "object"
  ) {
    problems.push(
      "Cached backtest is missing or not an object."
    );

    return problems;
  }

  if (
    backtest.evidenceType !==
      "weekly-sage-qb-backtest"
  ) {
    problems.push(
      `Unexpected evidenceType: ${backtest.evidenceType}`
    );
  }

  if (
    String(
      backtest.season
    ) !==
    String(
      season
    )
  ) {
    problems.push(
      `Season mismatch: requested ${season}, got ${backtest.season}`
    );
  }

  if (
    backtest.seasonType !==
    seasonType
  ) {
    problems.push(
      `seasonType mismatch: requested ${seasonType}, got ${backtest.seasonType}`
    );
  }

  const requestedWindow =
    backtest.requestedWindow ||
    {};

  if (
    Number(
      requestedWindow.startWeek
    ) !==
    Number(
      startWeek
    )
  ) {
    problems.push(
      `startWeek mismatch: expected ${startWeek}, got ${requestedWindow.startWeek}`
    );
  }

  if (
    Number(
      requestedWindow.endWeek
    ) !==
    Number(
      endWeek
    )
  ) {
    problems.push(
      `endWeek mismatch: expected ${endWeek}, got ${requestedWindow.endWeek}`
    );
  }

  if (
    !Array.isArray(
      backtest.observations
    ) ||
    backtest.observations.length ===
      0
  ) {
    problems.push(
      "Cached backtest observations are empty or not an array."
    );
  }

  const population =
    backtest.population ||
    {};

  if (
    Number(
      population.retrievalFailures ||
      0
    ) !==
    0
  ) {
    problems.push(
      `Cached backtest has ${population.retrievalFailures} retrieval failure(s).`
    );
  }

  if (
    Number(
      population.weeklyFailures ||
      0
    ) !==
    0
  ) {
    problems.push(
      `Cached backtest has ${population.weeklyFailures} weekly failure(s).`
    );
  }

  if (
    !backtest.nextStep ||
    backtest.nextStep.ready !==
      true
  ) {
    problems.push(
      "Cached backtest nextStep.ready is not true."
    );
  }

  return problems;
}

async function readCachedBlock({
  store,
  season,
  seasonType,
  block
}) {
  const key =
    blobKey({
      season,
      startWeek:
        block.startWeek,
      endWeek:
        block.endWeek,
      seasonType
    });

  let data =
    null;

  try {
    data =
      await store.get(
        key,
        {
          type:
            "json"
        }
      );
  } catch (
    error
  ) {
    return {
      ok:
        false,

      block,

      blobKey:
        key,

      error:
        error &&
        error.message
          ? error.message
          : String(
              error
            )
    };
  }

  if (
    !data
  ) {
    return {
      ok:
        false,

      block,

      blobKey:
        key,

      error:
        "Cached QB backtest block is missing."
    };
  }

  const problems =
    validateCachedBacktest({
      backtest:
        data,
      season,
      startWeek:
        block.startWeek,
      endWeek:
        block.endWeek,
      seasonType
    });

  if (
    problems.length >
    0
  ) {
    return {
      ok:
        false,

      block,

      blobKey:
        key,

      error:
        "Cached QB backtest block failed completeness validation.",

      problems
    };
  }

  return {
    ok:
      true,

    block,

    blobKey:
      key,

    data
  };
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
    i +=
      1
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
      let k =
        i;
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

function pearsonPairs(
  pairs
) {
  return pearsonArrays(
    pairs.map(
      function (
        pair
      ) {
        return (
          pair.x
        );
      }
    ),

    pairs.map(
      function (
        pair
      ) {
        return (
          pair.y
        );
      }
    )
  );
}

function spearmanPairs(
  pairs
) {
  if (
    pairs.length <
    2
  ) {
    return null;
  }

  const xs =
    pairs.map(
      function (
        pair
      ) {
        return (
          pair.x
        );
      }
    );

  const ys =
    pairs.map(
      function (
        pair
      ) {
        return (
          pair.y
        );
      }
    );

  return pearsonArrays(
    averageRanks(
      xs
    ),

    averageRanks(
      ys
    )
  );
}

function mean(
  values
) {
  const clean =
    values.filter(
      function (
        value
      ) {
        return (
          Number.isFinite(
            value
          )
        );
      }
    );

  if (
    clean.length ===
    0
  ) {
    return null;
  }

  return (
    clean.reduce(
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
    clean.length
  );
}

function median(
  values
) {
  const clean =
    values
      .filter(
        function (
          value
        ) {
          return (
            Number.isFinite(
              value
            )
          );
        }
      )
      .slice()
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
    clean.length ===
    0
  ) {
    return null;
  }

  const middle =
    Math.floor(
      clean.length /
      2
    );

  if (
    clean.length %
      2 ===
    1
  ) {
    return (
      clean[
        middle
      ]
    );
  }

  return (
    (
      clean[
        middle -
        1
      ] +
      clean[
        middle
      ]
    ) /
    2
  );
}

function standardDeviation(
  values
) {
  const clean =
    values.filter(
      function (
        value
      ) {
        return (
          Number.isFinite(
            value
          )
        );
      }
    );

  if (
    clean.length <
    2
  ) {
    return null;
  }

  const avg =
    mean(
      clean
    );

  const variance =
    clean.reduce(
      function (
        sum,
        value
      ) {
        const d =
          value -
          avg;

        return (
          sum +
          (
            d *
            d
          )
        );
      },
      0
    ) /
    clean.length;

  return (
    Math.sqrt(
      variance
    )
  );
}

function candidateScore(
  observation,
  weights
) {
  return (
    observation.components.role *
      weights.role +
    observation.components.production *
      weights.production +
    observation.components.matchup *
      weights.matchup
  );
}

function candidatePairs(
  observations,
  weights
) {
  const pairs =
    [];

  for (
    const observation of
    observations
  ) {
    const actual =
      nullableNum(
        observation.actual &&
        observation.actual.standard
      );

    const role =
      nullableNum(
        observation.components &&
        observation.components.role
      );

    const production =
      nullableNum(
        observation.components &&
        observation.components.production
      );

    const matchup =
      nullableNum(
        observation.components &&
        observation.components.matchup
      );

    if (
      actual ===
        null ||
      role ===
        null ||
      production ===
        null ||
      matchup ===
        null
    ) {
      continue;
    }

    pairs.push({
      x:
        candidateScore(
          {
            components: {
              role,
              production,
              matchup
            }
          },
          weights
        ),

      y:
        actual
    });
  }

  return pairs;
}

function correlationForObservations(
  observations,
  weights
) {
  const pairs =
    candidatePairs(
      observations,
      weights
    );

  const pearson =
    pearsonPairs(
      pairs
    );

  const spearman =
    spearmanPairs(
      pairs
    );

  return {
    observations:
      pairs.length,

    pearson:
      pearson ===
        null
        ? null
        : round(
            pearson,
            4
          ),

    spearman:
      spearman ===
        null
        ? null
        : round(
            spearman,
            4
          )
  };
}

function groupByWeek(
  observations
) {
  const map =
    new Map();

  for (
    const observation of
    observations
  ) {
    const week =
      Number(
        observation.seasonWeek
      );

    if (
      !Number.isInteger(
        week
      )
    ) {
      continue;
    }

    if (
      !map.has(
        week
      )
    ) {
      map.set(
        week,
        []
      );
    }

    map
      .get(
        week
      )
      .push(
        observation
      );
  }

  return map;
}

function weeklyStability(
  observations,
  weights
) {
  const grouped =
    groupByWeek(
      observations
    );

  const weeks =
    [];

  for (
    const [
      week,
      rows
    ] of
    grouped.entries()
  ) {
    const stats =
      correlationForObservations(
        rows,
        weights
      );

    weeks.push({
      week,

      observations:
        stats.observations,

      pearson:
        stats.pearson,

      spearman:
        stats.spearman
    });
  }

  weeks.sort(
    function (
      a,
      b
    ) {
      return (
        a.week -
        b.week
      );
    }
  );

  const spearmans =
    weeks
      .map(
        function (
          row
        ) {
          return (
            row.spearman
          );
        }
      )
      .filter(
        function (
          value
        ) {
          return (
            Number.isFinite(
              value
            )
          );
        }
      );

  return {
    weeks,

    meanSpearman:
      round(
        mean(
          spearmans
        ),
        4
      ),

    medianSpearman:
      round(
        median(
          spearmans
        ),
        4
      ),

    standardDeviationSpearman:
      round(
        standardDeviation(
          spearmans
        ),
        4
      ),

    negativeWeeks:
      spearmans.filter(
        function (
          value
        ) {
          return (
            value <
            0
          );
        }
      ).length,

    positiveWeeks:
      spearmans.filter(
        function (
          value
        ) {
          return (
            value >
            0
          );
        }
      ).length,

    zeroWeeks:
      spearmans.filter(
        function (
          value
        ) {
          return (
            value ===
            0
          );
        }
      ).length
  };
}

function segmentObservations(
  observations,
  startWeek,
  endWeek
) {
  return observations.filter(
    function (
      observation
    ) {
      const week =
        Number(
          observation.seasonWeek
        );

      return (
        week >=
          startWeek &&
        week <=
          endWeek
      );
    }
  );
}

function segmentAnalysis(
  observations,
  weights
) {
  const output =
    {};

  for (
    const [
      key,
      segment
    ] of
    Object.entries(
      ANALYSIS_SEGMENTS
    )
  ) {
    const rows =
      segmentObservations(
        observations,
        segment.startWeek,
        segment.endWeek
      );

    output[
      key
    ] = {
      startWeek:
        segment.startWeek,

      endWeek:
        segment.endWeek,

      ...correlationForObservations(
        rows,
        weights
      )
    };
  }

  return output;
}

function minSegmentSpearman(
  segments
) {
  const values =
    Object
      .values(
        segments
      )
      .map(
        function (
          segment
        ) {
          return (
            nullableNum(
              segment.spearman
            )
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

  return (
    Math.min(
      ...values
    )
  );
}

function weightKey(
  weights
) {
  return [
    weights.role,
    weights.production,
    weights.matchup
  ]
    .map(
      function (
        value
      ) {
        return (
          Math.round(
            value *
            100
          )
        );
      }
    )
    .join(
      "/"
    );
}

function sameWeights(
  a,
  b
) {
  const epsilon =
    1e-9;

  return (
    Math.abs(
      a.role -
      b.role
    ) <
      epsilon &&
    Math.abs(
      a.production -
      b.production
    ) <
      epsilon &&
    Math.abs(
      a.matchup -
      b.matchup
    ) <
      epsilon
  );
}

function namedReference(
  weights
) {
  if (
    sameWeights(
      weights,
      CONTROL_WEIGHTS
    )
  ) {
    return (
      "control"
    );
  }

  if (
    sameWeights(
      weights,
      CONSERVATIVE_CHALLENGER
    )
  ) {
    return (
      "conservative_challenger"
    );
  }

  if (
    sameWeights(
      weights,
      REFERENCE_GRID_LEADER
    )
  ) {
    return (
      "reference_grid_leader"
    );
  }

  return null;
}

function evaluateCandidate(
  observations,
  weights
) {
  const full =
    correlationForObservations(
      observations,
      weights
    );

  const segments =
    segmentAnalysis(
      observations,
      weights
    );

  const weekly =
    weeklyStability(
      observations,
      weights
    );

  return {
    key:
      weightKey(
        weights
      ),

    namedReference:
      namedReference(
        weights
      ),

    weights: {
      role:
        round(
          weights.role,
          2
        ),

      production:
        round(
          weights.production,
          2
        ),

      matchup:
        round(
          weights.matchup,
          2
        )
    },

    fullSample:
      full,

    segments,

    stability: {
      meanWeeklySpearman:
        weekly.meanSpearman,

      medianWeeklySpearman:
        weekly.medianSpearman,

      standardDeviationWeeklySpearman:
        weekly.standardDeviationSpearman,

      negativeWeeks:
        weekly.negativeWeeks,

      positiveWeeks:
        weekly.positiveWeeks,

      zeroWeeks:
        weekly.zeroWeeks
    },

    weeklyResults:
      weekly.weeks,

    rankingSignals: {
      fullSpearman:
        full.spearman,

      worstSegmentSpearman:
        round(
          minSegmentSpearman(
            segments
          ),
          4
        ),

      negativeWeeks:
        weekly.negativeWeeks,

      meanWeeklySpearman:
        weekly.meanSpearman,

      fullPearson:
        full.pearson
    }
  };
}

function buildGrid() {
  const candidates =
    [];

  const stepPoints =
    Math.round(
      GRID.step *
      100
    );

  const roleMin =
    Math.round(
      GRID.roleMin *
      100
    );

  const roleMax =
    Math.round(
      GRID.roleMax *
      100
    );

  const productionMin =
    Math.round(
      GRID.productionMin *
      100
    );

  const productionMax =
    Math.round(
      GRID.productionMax *
      100
    );

  const matchupMin =
    Math.round(
      GRID.matchupMin *
      100
    );

  const matchupMax =
    Math.round(
      GRID.matchupMax *
      100
    );

  for (
    let role =
      roleMin;
    role <=
      roleMax;
    role +=
      stepPoints
  ) {
    for (
      let production =
        productionMin;
      production <=
        productionMax;
      production +=
        stepPoints
    ) {
      const matchup =
        100 -
        role -
        production;

      if (
        matchup <
          matchupMin ||
        matchup >
          matchupMax
      ) {
        continue;
      }

      if (
        matchup %
          stepPoints !==
        0
      ) {
        continue;
      }

      candidates.push({
        role:
          role /
          100,

        production:
          production /
          100,

        matchup:
          matchup /
          100
      });
    }
  }

  return candidates;
}

function compareCandidates(
  a,
  b
) {
  const aSignals =
    a.rankingSignals;

  const bSignals =
    b.rankingSignals;

  const safe =
    function (
      value,
      fallback
    ) {
      return Number.isFinite(
        Number(
          value
        )
      )
        ? Number(
            value
          )
        : fallback;
    };

  const fullSpearmanDifference =
    safe(
      bSignals.fullSpearman,
      -Infinity
    ) -
    safe(
      aSignals.fullSpearman,
      -Infinity
    );

  if (
    fullSpearmanDifference !==
    0
  ) {
    return (
      fullSpearmanDifference
    );
  }

  const worstSegmentDifference =
    safe(
      bSignals.worstSegmentSpearman,
      -Infinity
    ) -
    safe(
      aSignals.worstSegmentSpearman,
      -Infinity
    );

  if (
    worstSegmentDifference !==
    0
  ) {
    return (
      worstSegmentDifference
    );
  }

  const negativeWeekDifference =
    safe(
      aSignals.negativeWeeks,
      Infinity
    ) -
    safe(
      bSignals.negativeWeeks,
      Infinity
    );

  if (
    negativeWeekDifference !==
    0
  ) {
    return (
      negativeWeekDifference
    );
  }

  const meanWeeklyDifference =
    safe(
      bSignals.meanWeeklySpearman,
      -Infinity
    ) -
    safe(
      aSignals.meanWeeklySpearman,
      -Infinity
    );

  if (
    meanWeeklyDifference !==
    0
  ) {
    return (
      meanWeeklyDifference
    );
  }

  return (
    safe(
      bSignals.fullPearson,
      -Infinity
    ) -
    safe(
      aSignals.fullPearson,
      -Infinity
    )
  );
}

function improvementVsControl(
  candidate,
  control
) {
  const candidateSpearman =
    nullableNum(
      candidate.fullSample.spearman
    );

  const controlSpearman =
    nullableNum(
      control.fullSample.spearman
    );

  const candidatePearson =
    nullableNum(
      candidate.fullSample.pearson
    );

  const controlPearson =
    nullableNum(
      control.fullSample.pearson
    );

  return {
    spearmanAbsolute:
      (
        candidateSpearman !==
          null &&
        controlSpearman !==
          null
      )
        ? round(
            candidateSpearman -
            controlSpearman,
            4
          )
        : null,

    spearmanPercent:
      (
        candidateSpearman !==
          null &&
        controlSpearman !==
          null &&
        controlSpearman !==
          0
      )
        ? round(
            (
              (
                candidateSpearman -
                controlSpearman
              ) /
              Math.abs(
                controlSpearman
              )
            ) *
            100,
            1
          )
        : null,

    pearsonAbsolute:
      (
        candidatePearson !==
          null &&
        controlPearson !==
          null
      )
        ? round(
            candidatePearson -
            controlPearson,
            4
          )
        : null,

    pearsonPercent:
      (
        candidatePearson !==
          null &&
        controlPearson !==
          null &&
        controlPearson !==
          0
      )
        ? round(
            (
              (
                candidatePearson -
                controlPearson
              ) /
              Math.abs(
                controlPearson
              )
            ) *
            100,
            1
          )
        : null,

    negativeWeekDifference:
      candidate.stability.negativeWeeks -
      control.stability.negativeWeeks,

    meanWeeklySpearmanDifference:
      (
        nullableNum(
          candidate.stability.meanWeeklySpearman
        ) !==
          null &&
        nullableNum(
          control.stability.meanWeeklySpearman
        ) !==
          null
      )
        ? round(
            candidate.stability.meanWeeklySpearman -
            control.stability.meanWeeklySpearman,
            4
          )
        : null
  };
}

function compactCandidate(
  candidate,
  control
) {
  return {
    rank:
      candidate.rank,

    key:
      candidate.key,

    namedReference:
      candidate.namedReference,

    weights:
      candidate.weights,

    fullSample:
      candidate.fullSample,

    segments:
      candidate.segments,

    stability:
      candidate.stability,

    rankingSignals:
      candidate.rankingSignals,

    improvementVsControl:
      improvementVsControl(
        candidate,
        control
      )
  };
}

function collectObservations(
  blockResults
) {
  const observations =
    [];

  const duplicateKeys =
    new Set();

  const seen =
    new Set();

  for (
    const result of
    blockResults
  ) {
    const rows =
      (
        result &&
        result.data &&
        Array.isArray(
          result.data.observations
        )
      )
        ? result.data.observations
        : [];

    for (
      const row of
      rows
    ) {
      const key =
        `${row.seasonWeek}|${row.playerID}`;

      if (
        seen.has(
          key
        )
      ) {
        duplicateKeys.add(
          key
        );

        continue;
      }

      seen.add(
        key
      );

      observations.push(
        row
      );
    }
  }

  observations.sort(
    function (
      a,
      b
    ) {
      if (
        a.seasonWeek !==
        b.seasonWeek
      ) {
        return (
          a.seasonWeek -
          b.seasonWeek
        );
      }

      return (
        String(
          a.playerID
        ).localeCompare(
          String(
            b.playerID
          )
        )
      );
    }
  );

  return {
    observations,

    duplicateKeys:
      Array.from(
        duplicateKeys
      ).sort()
  };
}

function participationDiagnostics(
  observations
) {
  const zeroOpportunity =
    observations.filter(
      function (
        observation
      ) {
        const passingYards =
          nullableNum(
            observation.actual &&
            observation.actual.passingYards
          );

        const carries =
          nullableNum(
            observation.actual &&
            observation.actual.carries
          );

        return (
          passingYards ===
            0 &&
          carries ===
            0
        );
      }
    );

  const veryLowOutput =
    observations.filter(
      function (
        observation
      ) {
        const passingYards =
          nullableNum(
            observation.actual &&
            observation.actual.passingYards
          );

        const carries =
          nullableNum(
            observation.actual &&
            observation.actual.carries
          );

        return (
          passingYards !==
            null &&
          carries !==
            null &&
          passingYards <=
            10 &&
          carries <=
            1
        );
      }
    );

  return {
    note:
      "These are diagnostics only. No observation is excluded by outcome-based participation heuristics because actual production must not define pre-game eligibility.",

    zeroPassingYardsAndZeroCarries:
      zeroOpportunity.length,

    veryLowOutputRows:
      veryLowOutput.length,

    examples:
      veryLowOutput
        .slice(
          0,
          20
        )
        .map(
          function (
            observation
          ) {
            return {
              week:
                observation.seasonWeek,

              playerID:
                observation.playerID,

              name:
                observation.name,

              sageScore:
                observation.sageScore,

              passingYards:
                observation.actual &&
                observation.actual.passingYards,

              carries:
                observation.actual &&
                observation.actual.carries,

              standardFantasyPoints:
                observation.actual &&
                observation.actual.standard
            };
          }
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

    const seasonType =
      String(
        query.seasonType ||
        DEFAULT_SEASON_TYPE
      );

    const topNRaw =
      Number(
        query.topN ||
        15
      );

    const topN =
      Number.isInteger(
        topNRaw
      )
        ? Math.max(
            1,
            Math.min(
              50,
              topNRaw
            )
          )
        : 15;

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
      /*
        STEP 1
        ------
        Read the already-proven historical QB backtest blocks directly
        from Netlify Blobs.

        No historical validation or player-season computation happens
        inside this endpoint.
      */
      const store =
        getStore({
          name:
            STORE_NAME
        });

      const blockResults =
        await Promise.all(
          CACHED_BLOCKS.map(
            function (
              block
            ) {
              return readCachedBlock({
                store,
                season,
                seasonType,
                block
              });
            }
          )
        );

      const failures =
        blockResults.filter(
          function (
            result
          ) {
            return (
              !result.ok
            );
          }
        );

      if (
        failures.length >
        0
      ) {
        return jsonResponse(
          503,
          {
            error:
              "One or more cached QB backtest blocks are missing or incomplete.",

            blobStore:
              STORE_NAME,

            failures:
              failures.map(
                function (
                  failure
                ) {
                  return {
                    block:
                      failure.block,

                    blobKey:
                      failure.blobKey,

                    error:
                      failure.error,

                    problems:
                      failure.problems ||
                      []
                  };
                }
              ),

            nextStep: {
              ready:
                false,

              reason:
                "All four cached historical blocks must be present and complete before QB weight sensitivity can be interpreted."
            }
          }
        );
      }

      const collected =
        collectObservations(
          blockResults
        );

      const observations =
        collected.observations;

      if (
        observations.length ===
        0
      ) {
        return jsonResponse(
          422,
          {
            error:
              "No clean QB player-week observations were available from the cached backtests."
          }
        );
      }

      /*
        Guard against accidentally running sensitivity on a partial
        historical population.

        The proven Weeks 4-17 cache currently contains exactly
        405 clean player-week observations.

        This is not used to manipulate the sample. It is a diagnostic
        safeguard so a missing/truncated block cannot silently produce
        a misleading weight recommendation.
      */
      const expectedWeeks =
        [];

      for (
        let week =
          4;
        week <=
          17;
        week +=
          1
      ) {
        expectedWeeks.push(
          week
        );
      }

      const actualWeeks =
        Array.from(
          new Set(
            observations.map(
              function (
                observation
              ) {
                return (
                  Number(
                    observation.seasonWeek
                  )
                );
              }
            )
          )
        )
          .filter(
            function (
              week
            ) {
              return (
                Number.isInteger(
                  week
                )
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

      const missingWeeks =
        expectedWeeks.filter(
          function (
            week
          ) {
            return (
              !actualWeeks.includes(
                week
              )
            );
          }
        );

      if (
        missingWeeks.length >
        0
      ) {
        return jsonResponse(
          422,
          {
            error:
              "Cached QB backtest population does not contain every expected Week 4-17 validation week.",

            missingWeeks,

            actualWeeks,

            observations:
              observations.length
          }
        );
      }

      /*
        STEP 2
        ------
        Evaluate the fixed control plus the interpretable 5-point grid.
      */
      const grid =
        buildGrid();

      const evaluated =
        grid.map(
          function (
            weights
          ) {
            return evaluateCandidate(
              observations,
              weights
            );
          }
        );

      let control =
        evaluated.find(
          function (
            candidate
          ) {
            return sameWeights(
              candidate.weights,
              CONTROL_WEIGHTS
            );
          }
        );

      if (
        !control
      ) {
        control =
          evaluateCandidate(
            observations,
            CONTROL_WEIGHTS
          );

        evaluated.push(
          control
        );
      }

      evaluated.sort(
        compareCandidates
      );

      evaluated.forEach(
        function (
          candidate,
          index
        ) {
          candidate.rank =
            index +
            1;
        }
      );

      control =
        evaluated.find(
          function (
            candidate
          ) {
            return sameWeights(
              candidate.weights,
              CONTROL_WEIGHTS
            );
          }
        );

      const conservative =
        evaluated.find(
          function (
            candidate
          ) {
            return sameWeights(
              candidate.weights,
              CONSERVATIVE_CHALLENGER
            );
          }
        );

      const referenceLeader =
        evaluated.find(
          function (
            candidate
          ) {
            return sameWeights(
              candidate.weights,
              REFERENCE_GRID_LEADER
            );
          }
        );

      const leader =
        evaluated[
          0
        ];

      const topCandidates =
        evaluated
          .slice(
            0,
            topN
          )
          .map(
            function (
              candidate
            ) {
              return compactCandidate(
                candidate,
                control
              );
            }
          );

      const namedReferences = {
        control:
          compactCandidate(
            control,
            control
          ),

        conservativeChallenger:
          conservative
            ? compactCandidate(
                conservative,
                control
              )
            : null,

        priorReferenceGridLeader:
          referenceLeader
            ? compactCandidate(
                referenceLeader,
                control
              )
            : null,

        currentGridLeader:
          compactCandidate(
            leader,
            control
          )
      };

      return jsonResponse(
        200,
        {
          evidenceType:
            "weekly-sage-qb-weight-sensitivity",

          schemaVersion:
            2,

          generatedAt:
            new Date()
              .toISOString(),

          season,

          seasonType,

          methodology: {
            modelVersion:
              "qb-sage-v1",

            status:
              "Research-only QB weight sensitivity. Production QB SAGE remains unchanged.",

            controlWeights:
              CONTROL_WEIGHTS,

            grid:
              GRID,

            candidateCount:
              evaluated.length,

            rankingRule: [
              "Higher full-sample Spearman",
              "Higher worst-segment Spearman",
              "Fewer negative-correlation weeks",
              "Higher mean weekly Spearman",
              "Higher full-sample Pearson"
            ],

            primaryMetric:
              "Spearman rank correlation is primary because Weekly SAGE is principally a weekly decision/ranking system rather than an exact fantasy-point projection.",

            leakageProtection:
              "All candidates reweight the same frozen pre-game Role / Production / Matchup component scores. Actual results are used only as post-game evaluation targets.",

            overfitProtection: [
              "Interpretable 5-point grid rather than unconstrained numerical optimization",
              "Full-sample and early/middle/late segment results reported together",
              "Weekly stability and negative-correlation weeks explicitly reported",
              "Existing 55/40/5 model remains the named control",
              "No candidate is written back into qb-sage-v1"
            ],

            cacheArchitecture:
              "Reads four complete immutable historical QB backtest blocks from Netlify Blobs. No historical backtest or player-season computation occurs inside this endpoint.",

            important:
              "A top-ranked historical candidate is evidence for further validation, not automatic authorization to change production weights."
          },

          population: {
            blobStore:
              STORE_NAME,

            blocksRequested:
              CACHED_BLOCKS,

            blocksRetrieved:
              blockResults.length,

            cleanPlayerWeekObservations:
              observations.length,

            duplicatePlayerWeekRowsIgnored:
              collected.duplicateKeys.length,

            expectedWeeks,

            actualWeeks,

            missingWeeks
          },

          sourceBlocks:
            blockResults.map(
              function (
                result
              ) {
                return {
                  key:
                    result.block.key,

                  startWeek:
                    result.block.startWeek,

                  endWeek:
                    result.block.endWeek,

                  blobKey:
                    result.blobKey,

                  observations:
                    (
                      result.data &&
                      result.data.population &&
                      result.data.population
                        .cleanPlayerWeekObservations !==
                        undefined
                    )
                      ? result.data.population
                          .cleanPlayerWeekObservations
                      : Array.isArray(
                          result.data &&
                          result.data.observations
                        )
                        ? result.data
                            .observations
                            .length
                        : null,

                  generatedAt:
                    result.data &&
                    result.data.generatedAt
                      ? result.data.generatedAt
                      : null,

                  ready:
                    (
                      result.data &&
                      result.data.nextStep &&
                      result.data.nextStep.ready ===
                        true
                    )
                };
              }
            ),

          namedReferences,

          topCandidates,

          participationDiagnostics:
            participationDiagnostics(
              observations
            ),

          recommendation:
            null,

          productionWeightChange:
            null,

          nextStep: {
            ready:
              true,

            reason:
              "QB weight-sensitivity grid is complete on the full cached Weeks 4-17 population. Review whether the leader materially and consistently beats 55/40/5 across the full sample, early/middle/late segments, and weekly stability before considering a second-stage validation or production weight change."
          },

          architecture: {
            modelVersion:
              "qb-sage-v1",

            backtestCacheStore:
              STORE_NAME,

            historicalBlocks:
              CACHED_BLOCKS,

            analysisSegments:
              ANALYSIS_SEGMENTS,

            recalculatesHistoricalBacktests:
              false,

            recalculatesHistoricalComponents:
              false,

            recalculatesHistoricalOutcomes:
              false,

            optimizesComponentFormulas:
              false,

            writesProductionWeights:
              false,

            directTank01Calls:
              0
          },

          provenance: {
            control:
              "55/40/5",

            sourceBacktest:
              "weekly-sage-qb-backtest",

            cachedBy:
              "refresh-qb-backtest-cache",

            roleAndProduction:
              "weekly-sage-qb-component-scores",

            confidence:
              "weekly-sage-qb-confidence",

            matchup:
              "weekly-sage-player-matchup",

            outcomes:
              "weekly-sage-player-season"
          }
        },

        CACHE_CONTROL
      );
    } catch (
      error
    ) {
      console.error(
        "weekly-sage-qb-weight-sensitivity failed:",
        error
      );

      return jsonResponse(
        502,
        {
          error:
            "Could not build Weekly SAGE QB weight sensitivity analysis from cached backtests.",

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
