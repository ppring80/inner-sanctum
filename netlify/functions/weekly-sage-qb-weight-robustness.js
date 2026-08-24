// netlify/functions/weekly-sage-qb-weight-robustness.js
//
// WEEKLY SAGE — QB WEIGHT ROBUSTNESS v1
//
// PURPOSE
// -------
// Evaluate a SMALL, PREDETERMINED set of QB Role / Production / Matchup
// weight candidates against held-out portions of the SAME frozen historical
// Weeks 4-17 QB validation population already cached in Netlify Blobs.
//
// This is a RESEARCH endpoint only.
//
// It DOES NOT:
//   - change qb-sage-v1
//   - search for new weights inside held-out data
//   - change Role / Production / Matchup component formulas
//   - write production weights
//   - create recommendation thresholds
//   - feed actual target-week outcomes back into historical predictions
//
// CONTROL
// -------
//   55 / 40 / 5
//
// PREDETERMINED CHALLENGERS
// ------------------------
//   40 / 50 / 10
//   30 / 50 / 20
//   25 / 55 / 20
//   20 / 60 / 20
//
// CACHED HISTORICAL BLOCKS
// ------------------------
//   Weeks 4-7
//   Weeks 8-10
//   Weeks 11-14
//   Weeks 15-17
//
// ROBUSTNESS PRINCIPLE
// --------------------
// The challenger set is frozen BEFORE this endpoint evaluates held-out
// periods. The endpoint reports performance on multiple predetermined
// train/test splits, but DOES NOT pick new weights from the training side.
//
// DECISION BAR
// ------------
// A challenger is considered to have strong evidence only when it:
//   - improves average held-out Spearman by about +0.025 or more,
//   - improves on multiple held-out splits,
//   - does not materially collapse any held-out segment,
//   - and improves weekly stability / negative-week behavior.
//
// STORE
// -----
//   qb-backtest
//
// ═══════════════════════════════════════════════════════════════════════

const {
  connectLambda,
  getStore
} = require("@netlify/blobs");

const DEFAULT_SEASON_TYPE = "reg";
const STORE_NAME = "qb-backtest";

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

const CONTROL_KEY = "55/40/5";

const CANDIDATES = [
  {
    key: "55/40/5",
    label: "control",
    weights: {
      role: 0.55,
      production: 0.40,
      matchup: 0.05
    }
  },
  {
    key: "40/50/10",
    label: "conservative_challenger",
    weights: {
      role: 0.40,
      production: 0.50,
      matchup: 0.10
    }
  },
  {
    key: "30/50/20",
    label: "balanced_20_matchup",
    weights: {
      role: 0.30,
      production: 0.50,
      matchup: 0.20
    }
  },
  {
    key: "25/55/20",
    label: "grid_leader",
    weights: {
      role: 0.25,
      production: 0.55,
      matchup: 0.20
    }
  },
  {
    key: "20/60/20",
    label: "stability_leader",
    weights: {
      role: 0.20,
      production: 0.60,
      matchup: 0.20
    }
  }
];

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

/*
  Predetermined robustness splits.

  These are NOT optimized after seeing results.
*/
const ROBUSTNESS_SPLITS = [
  {
    key: "train_4_10_test_11_17",
    label: "Train Weeks 4-10 / Test Weeks 11-17",
    trainRanges: [
      { startWeek: 4, endWeek: 10 }
    ],
    testRanges: [
      { startWeek: 11, endWeek: 17 }
    ]
  },
  {
    key: "train_4_13_test_14_17",
    label: "Train Weeks 4-13 / Test Weeks 14-17",
    trainRanges: [
      { startWeek: 4, endWeek: 13 }
    ],
    testRanges: [
      { startWeek: 14, endWeek: 17 }
    ]
  },
  {
    key: "train_8_17_test_4_7",
    label: "Train Weeks 8-17 / Test Weeks 4-7",
    trainRanges: [
      { startWeek: 8, endWeek: 17 }
    ],
    testRanges: [
      { startWeek: 4, endWeek: 7 }
    ]
  },
  {
    key: "train_4_12_test_13_17",
    label: "Train Weeks 4-12 / Test Weeks 13-17",
    trainRanges: [
      { startWeek: 4, endWeek: 12 }
    ],
    testRanges: [
      { startWeek: 13, endWeek: 17 }
    ]
  },
  {
    key: "train_outer_test_8_14",
    label: "Train Weeks 4-7 and 15-17 / Test Weeks 8-14",
    trainRanges: [
      { startWeek: 4, endWeek: 7 },
      { startWeek: 15, endWeek: 17 }
    ],
    testRanges: [
      { startWeek: 8, endWeek: 14 }
    ]
  }
];

const DECISION_BAR = {
  targetAverageHeldOutSpearmanDelta: 0.025,
  minimumPositiveSplitCount: 3,
  maximumMeaningfulSplitDeterioration: -0.015,
  preferredMaximumNegativeWeeks: 2
};

function nullableNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, digits = 4) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return null;
  }

  const factor = Math.pow(10, digits);

  return Math.round(
    (n + Number.EPSILON) *
    factor
  ) / factor;
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
  const problems = [];

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
      `Season mismatch: expected ${season}, got ${backtest.season}`
    );
  }

  if (
    backtest.seasonType !==
    seasonType
  ) {
    problems.push(
      `seasonType mismatch: expected ${seasonType}, got ${backtest.seasonType}`
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

  let data = null;

  try {
    data =
      await store.get(
        key,
        {
          type: "json"
        }
      );
  } catch (error) {
    return {
      ok: false,
      block,
      blobKey: key,
      error:
        error &&
        error.message
          ? error.message
          : String(error)
    };
  }

  if (!data) {
    return {
      ok: false,
      block,
      blobKey: key,
      error:
        "Cached QB backtest block is missing."
    };
  }

  const problems =
    validateCachedBacktest({
      backtest: data,
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
      ok: false,
      block,
      blobKey: key,
      error:
        "Cached QB backtest block failed completeness validation.",
      problems
    };
  }

  return {
    ok: true,
    block,
    blobKey: key,
    data
  };
}

function collectObservations(
  blockResults
) {
  const observations = [];
  const seen = new Set();
  const duplicates = [];

  for (
    const result of
    blockResults
  ) {
    const rows =
      result &&
      result.data &&
      Array.isArray(
        result.data.observations
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
        duplicates.push(key);
        continue;
      }

      seen.add(key);
      observations.push(row);
    }
  }

  observations.sort(
    function (a, b) {
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
        new Set(
          duplicates
        )
      ).sort()
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

  let numerator = 0;
  let denominatorX = 0;
  let denominatorY = 0;

  for (
    let i = 0;
    i <
    xs.length;
    i += 1
  ) {
    const dx =
      xs[i] -
      meanX;

    const dy =
      ys[i] -
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
    function (a, b) {
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

  let i = 0;

  while (
    i <
    indexed.length
  ) {
    let j =
      i + 1;

    while (
      j <
        indexed.length &&
      indexed[j].value ===
        indexed[i].value
    ) {
      j += 1;
    }

    const averageRank =
      (
        (i + 1) +
        j
      ) /
      2;

    for (
      let k = i;
      k < j;
      k += 1
    ) {
      ranks[
        indexed[k].index
      ] =
        averageRank;
    }

    i = j;
  }

  return ranks;
}

function spearmanArrays(
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

  return pearsonArrays(
    averageRanks(xs),
    averageRanks(ys)
  );
}

function mean(values) {
  const clean =
    values.filter(
      function (value) {
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

function median(values) {
  const clean =
    values
      .filter(
        function (value) {
          return (
            Number.isFinite(
              value
            )
          );
        }
      )
      .slice()
      .sort(
        function (a, b) {
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
      clean[middle]
    );
  }

  return (
    (
      clean[
        middle - 1
      ] +
      clean[middle]
    ) /
    2
  );
}

function standardDeviation(
  values
) {
  const clean =
    values.filter(
      function (value) {
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
    mean(clean);

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
          d *
          d
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

function correlationForObservations(
  observations,
  weights
) {
  const xs = [];
  const ys = [];

  for (
    const observation of
    observations
  ) {
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

    const actual =
      nullableNum(
        observation.actual &&
        observation.actual.standard
      );

    if (
      role === null ||
      production === null ||
      matchup === null ||
      actual === null
    ) {
      continue;
    }

    xs.push(
      candidateScore(
        {
          components: {
            role,
            production,
            matchup
          }
        },
        weights
      )
    );

    ys.push(actual);
  }

  const pearson =
    pearsonArrays(
      xs,
      ys
    );

  const spearman =
    spearmanArrays(
      xs,
      ys
    );

  return {
    observations:
      xs.length,

    pearson:
      pearson ===
        null
        ? null
        : round(
            pearson
          ),

    spearman:
      spearman ===
        null
        ? null
        : round(
            spearman
          )
  };
}

function rangesContainWeek(
  ranges,
  week
) {
  return ranges.some(
    function (range) {
      return (
        week >=
          range.startWeek &&
        week <=
          range.endWeek
      );
    }
  );
}

function observationsForRanges(
  observations,
  ranges
) {
  return observations.filter(
    function (observation) {
      const week =
        Number(
          observation.seasonWeek
        );

      return (
        Number.isInteger(
          week
        ) &&
        rangesContainWeek(
          ranges,
          week
        )
      );
    }
  );
}

function groupByWeek(
  observations
) {
  const grouped =
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
      !grouped.has(
        week
      )
    ) {
      grouped.set(
        week,
        []
      );
    }

    grouped
      .get(
        week
      )
      .push(
        observation
      );
  }

  return grouped;
}

function weeklyStability(
  observations,
  weights
) {
  const grouped =
    groupByWeek(
      observations
    );

  const weeklyResults = [];

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

    weeklyResults.push({
      week,
      observations:
        stats.observations,
      pearson:
        stats.pearson,
      spearman:
        stats.spearman
    });
  }

  weeklyResults.sort(
    function (a, b) {
      return (
        a.week -
        b.week
      );
    }
  );

  const spearmans =
    weeklyResults
      .map(
        function (row) {
          return nullableNum(
            row.spearman
          );
        }
      )
      .filter(
        function (value) {
          return (
            value !==
            null
          );
        }
      );

  return {
    weeklyResults,

    meanWeeklySpearman:
      round(
        mean(
          spearmans
        )
      ),

    medianWeeklySpearman:
      round(
        median(
          spearmans
        )
      ),

    standardDeviationWeeklySpearman:
      round(
        standardDeviation(
          spearmans
        )
      ),

    negativeWeeks:
      spearmans.filter(
        function (value) {
          return (
            value <
            0
          );
        }
      ).length,

    positiveWeeks:
      spearmans.filter(
        function (value) {
          return (
            value >
            0
          );
        }
      ).length,

    zeroWeeks:
      spearmans.filter(
        function (value) {
          return (
            value ===
            0
          );
        }
      ).length
  };
}

function evaluateRanges(
  observations,
  weights,
  ranges
) {
  const rows =
    observationsForRanges(
      observations,
      ranges
    );

  const correlation =
    correlationForObservations(
      rows,
      weights
    );

  const stability =
    weeklyStability(
      rows,
      weights
    );

  return {
    ranges,

    observations:
      correlation.observations,

    pearson:
      correlation.pearson,

    spearman:
      correlation.spearman,

    stability: {
      meanWeeklySpearman:
        stability.meanWeeklySpearman,

      medianWeeklySpearman:
        stability.medianWeeklySpearman,

      standardDeviationWeeklySpearman:
        stability.standardDeviationWeeklySpearman,

      negativeWeeks:
        stability.negativeWeeks,

      positiveWeeks:
        stability.positiveWeeks,

      zeroWeeks:
        stability.zeroWeeks
    },

    weeklyResults:
      stability.weeklyResults
  };
}

function evaluateCandidate(
  observations,
  candidate
) {
  const full =
    correlationForObservations(
      observations,
      candidate.weights
    );

  const fullStability =
    weeklyStability(
      observations,
      candidate.weights
    );

  const splits = {};

  for (
    const split of
    ROBUSTNESS_SPLITS
  ) {
    splits[
      split.key
    ] = {
      label:
        split.label,

      train:
        evaluateRanges(
          observations,
          candidate.weights,
          split.trainRanges
        ),

      test:
        evaluateRanges(
          observations,
          candidate.weights,
          split.testRanges
        )
    };
  }

  return {
    key:
      candidate.key,

    label:
      candidate.label,

    weights:
      candidate.weights,

    fullSample:
      full,

    fullStability: {
      meanWeeklySpearman:
        fullStability.meanWeeklySpearman,

      medianWeeklySpearman:
        fullStability.medianWeeklySpearman,

      standardDeviationWeeklySpearman:
        fullStability.standardDeviationWeeklySpearman,

      negativeWeeks:
        fullStability.negativeWeeks,

      positiveWeeks:
        fullStability.positiveWeeks,

      zeroWeeks:
        fullStability.zeroWeeks
    },

    splits
  };
}

function attachControlComparison(
  result,
  control
) {
  const splitComparisons = {};
  const heldOutDeltas = [];

  for (
    const split of
    ROBUSTNESS_SPLITS
  ) {
    const challengerSplit =
      result.splits[
        split.key
      ];

    const controlSplit =
      control.splits[
        split.key
      ];

    const challengerSpearman =
      nullableNum(
        challengerSplit &&
        challengerSplit.test.spearman
      );

    const controlSpearman =
      nullableNum(
        controlSplit &&
        controlSplit.test.spearman
      );

    const challengerPearson =
      nullableNum(
        challengerSplit &&
        challengerSplit.test.pearson
      );

    const controlPearson =
      nullableNum(
        controlSplit &&
        controlSplit.test.pearson
      );

    const spearmanDelta =
      challengerSpearman !==
        null &&
      controlSpearman !==
        null
        ? round(
            challengerSpearman -
            controlSpearman
          )
        : null;

    const pearsonDelta =
      challengerPearson !==
        null &&
      controlPearson !==
        null
        ? round(
            challengerPearson -
            controlPearson
          )
        : null;

    if (
      spearmanDelta !==
      null
    ) {
      heldOutDeltas.push(
        spearmanDelta
      );
    }

    splitComparisons[
      split.key
    ] = {
      label:
        split.label,

      controlHeldOutSpearman:
        controlSpearman,

      challengerHeldOutSpearman:
        challengerSpearman,

      heldOutSpearmanDelta:
        spearmanDelta,

      controlHeldOutPearson:
        controlPearson,

      challengerHeldOutPearson:
        challengerPearson,

      heldOutPearsonDelta:
        pearsonDelta,

      improvesSpearman:
        spearmanDelta !==
          null
          ? spearmanDelta >
            0
          : null,

      materiallyWorseSpearman:
        spearmanDelta !==
          null
          ? spearmanDelta <
            DECISION_BAR
              .maximumMeaningfulSplitDeterioration
          : null
    };
  }

  const averageHeldOutSpearmanDelta =
    mean(
      heldOutDeltas
    );

  const positiveSplitCount =
    heldOutDeltas.filter(
      function (value) {
        return (
          value >
          0
        );
      }
    ).length;

  const materiallyWorseSplitCount =
    heldOutDeltas.filter(
      function (value) {
        return (
          value <
          DECISION_BAR
            .maximumMeaningfulSplitDeterioration
        );
      }
    ).length;

  const fullSpearman =
    nullableNum(
      result.fullSample.spearman
    );

  const controlFullSpearman =
    nullableNum(
      control.fullSample.spearman
    );

  const fullPearson =
    nullableNum(
      result.fullSample.pearson
    );

  const controlFullPearson =
    nullableNum(
      control.fullSample.pearson
    );

  const fullSpearmanDelta =
    fullSpearman !==
      null &&
    controlFullSpearman !==
      null
      ? round(
          fullSpearman -
          controlFullSpearman
        )
      : null;

  const fullPearsonDelta =
    fullPearson !==
      null &&
    controlFullPearson !==
      null
      ? round(
          fullPearson -
          controlFullPearson
        )
      : null;

  const negativeWeekDifference =
    result.fullStability
      .negativeWeeks -
    control.fullStability
      .negativeWeeks;

  const meanWeeklySpearmanDifference =
    nullableNum(
      result.fullStability
        .meanWeeklySpearman
    ) !==
      null &&
    nullableNum(
      control.fullStability
        .meanWeeklySpearman
    ) !==
      null
      ? round(
          result.fullStability
            .meanWeeklySpearman -
          control.fullStability
            .meanWeeklySpearman
        )
      : null;

  const passesAverageDelta =
    Number.isFinite(
      averageHeldOutSpearmanDelta
    ) &&
    averageHeldOutSpearmanDelta >=
      DECISION_BAR
        .targetAverageHeldOutSpearmanDelta;

  const passesPositiveSplits =
    positiveSplitCount >=
    DECISION_BAR
      .minimumPositiveSplitCount;

  const passesNoCollapse =
    materiallyWorseSplitCount ===
    0;

  const passesNegativeWeeks =
    result.fullStability
      .negativeWeeks <=
    DECISION_BAR
      .preferredMaximumNegativeWeeks;

  return {
    ...result,

    comparisonVsControl: {
      fullSpearmanDelta,

      fullPearsonDelta,

      averageHeldOutSpearmanDelta:
        averageHeldOutSpearmanDelta ===
          null
          ? null
          : round(
              averageHeldOutSpearmanDelta
            ),

      positiveHeldOutSplits:
        positiveSplitCount,

      heldOutSplitCount:
        heldOutDeltas.length,

      materiallyWorseHeldOutSplits:
        materiallyWorseSplitCount,

      negativeWeekDifference,

      meanWeeklySpearmanDifference,

      splitComparisons,

      decisionChecks: {
        passesAverageHeldOutSpearmanDelta:
          passesAverageDelta,

        passesMinimumPositiveSplitCount:
          passesPositiveSplits,

        passesNoMaterialHeldOutCollapse:
          passesNoCollapse,

        passesPreferredNegativeWeekLimit:
          passesNegativeWeeks
      },

      passesDecisionBar:
        passesAverageDelta &&
        passesPositiveSplits &&
        passesNoCollapse &&
        passesNegativeWeeks
    }
  };
}

function robustnessSort(
  a,
  b
) {
  function safe(
    value,
    fallback
  ) {
    const n =
      Number(
        value
      );

    return Number.isFinite(
      n
    )
      ? n
      : fallback;
  }

  const aPass =
    a.comparisonVsControl &&
    a.comparisonVsControl
      .passesDecisionBar
      ? 1
      : 0;

  const bPass =
    b.comparisonVsControl &&
    b.comparisonVsControl
      .passesDecisionBar
      ? 1
      : 0;

  if (
    aPass !==
    bPass
  ) {
    return (
      bPass -
      aPass
    );
  }

  const avgDeltaDifference =
    safe(
      b.comparisonVsControl
        .averageHeldOutSpearmanDelta,
      -Infinity
    ) -
    safe(
      a.comparisonVsControl
        .averageHeldOutSpearmanDelta,
      -Infinity
    );

  if (
    avgDeltaDifference !==
    0
  ) {
    return (
      avgDeltaDifference
    );
  }

  const positiveSplitDifference =
    safe(
      b.comparisonVsControl
        .positiveHeldOutSplits,
      -Infinity
    ) -
    safe(
      a.comparisonVsControl
        .positiveHeldOutSplits,
      -Infinity
    );

  if (
    positiveSplitDifference !==
    0
  ) {
    return (
      positiveSplitDifference
    );
  }

  const negativeWeekDifference =
    safe(
      a.fullStability
        .negativeWeeks,
      Infinity
    ) -
    safe(
      b.fullStability
        .negativeWeeks,
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

  return (
    safe(
      b.fullSample
        .spearman,
      -Infinity
    ) -
    safe(
      a.fullSample
        .spearman,
      -Infinity
    )
  );
}

function participationDiagnostics(
  observations
) {
  const veryLowOutput =
    observations.filter(
      function (
        observation
      ) {
        const passingYards =
          nullableNum(
            observation.actual &&
            observation.actual
              .passingYards
          );

        const carries =
          nullableNum(
            observation.actual &&
            observation.actual
              .carries
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
      "Diagnostics only. No observation is excluded using actual fantasy output because post-game production must not define pre-game eligibility.",

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
                observation.actual
                  .passingYards,

              carries:
                observation.actual &&
                observation.actual
                  .carries,

              standardFantasyPoints:
                observation.actual &&
                observation.actual
                  .standard
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
                "All four cached historical blocks must be complete before QB robustness testing can be interpreted."
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

      const expectedWeeks =
        [];

      for (
        let week = 4;
        week <= 17;
        week += 1
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
                return Number(
                  observation.seasonWeek
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

            expectedWeeks,

            actualWeeks,

            missingWeeks,

            observations:
              observations.length
          }
        );
      }

      /*
        STEP 1
        ------
        Evaluate ONLY the predetermined candidates.
      */
      const rawResults =
        CANDIDATES.map(
          function (
            candidate
          ) {
            return evaluateCandidate(
              observations,
              candidate
            );
          }
        );

      const control =
        rawResults.find(
          function (
            result
          ) {
            return (
              result.key ===
              CONTROL_KEY
            );
          }
        );

      if (
        !control
      ) {
        throw new Error(
          "Predetermined QB control candidate is missing."
        );
      }

      /*
        STEP 2
        ------
        Attach held-out comparisons against the frozen control.
      */
      const evaluated =
        rawResults.map(
          function (
            result
          ) {
            return attachControlComparison(
              result,
              control
            );
          }
        );

      evaluated.sort(
        robustnessSort
      );

      evaluated.forEach(
        function (
          candidate,
          index
        ) {
          candidate.robustnessRank =
            index + 1;
        }
      );

      const rankedControl =
        evaluated.find(
          function (
            result
          ) {
            return (
              result.key ===
              CONTROL_KEY
            );
          }
        );

      const challengers =
        evaluated.filter(
          function (
            result
          ) {
            return (
              result.key !==
              CONTROL_KEY
            );
          }
        );

      const passingChallengers =
        challengers.filter(
          function (
            result
          ) {
            return (
              result.comparisonVsControl &&
              result.comparisonVsControl
                .passesDecisionBar ===
                true
            );
          }
        );

      const bestChallenger =
        challengers.length >
        0
          ? challengers[0]
          : null;

      const strongestPassingChallenger =
        passingChallengers.length >
        0
          ? passingChallengers[0]
          : null;

      return jsonResponse(
        200,
        {
          evidenceType:
            "weekly-sage-qb-weight-robustness",

          schemaVersion:
            1,

          generatedAt:
            new Date()
              .toISOString(),

          season,

          seasonType,

          methodology: {
            modelVersion:
              "qb-sage-v1",

            status:
              "Research-only held-out robustness test. Production QB SAGE remains unchanged.",

            control:
              CANDIDATES.find(
                function (
                  candidate
                ) {
                  return (
                    candidate.key ===
                    CONTROL_KEY
                  );
                }
              ),

            predeterminedCandidates:
              CANDIDATES,

            predeterminedSplits:
              ROBUSTNESS_SPLITS,

            decisionBar:
              DECISION_BAR,

            primaryMetric:
              "Held-out Spearman rank correlation. Weekly SAGE is primarily a weekly decision/ranking system, not an exact fantasy-point projection.",

            leakageProtection:
              "All candidate weights were predetermined before this robustness endpoint evaluates held-out periods. Actual target-week outcomes are used only for post-game evaluation.",

            important:
              "This endpoint does not search for new weights inside any train or test split. It only compares the five predetermined candidates against the frozen 55/40/5 control."
          },

          population: {
            blobStore:
              STORE_NAME,

            cleanPlayerWeekObservations:
              observations.length,

            duplicatePlayerWeekRowsIgnored:
              collected
                .duplicateKeys
                .length,

            expectedWeeks,

            actualWeeks,

            missingWeeks,

            cachedBlocks:
              blockResults.map(
                function (
                  result
                ) {
                  return {
                    key:
                      result.block.key,

                    startWeek:
                      result.block
                        .startWeek,

                    endWeek:
                      result.block
                        .endWeek,

                    blobKey:
                      result.blobKey,

                    observations:
                      result.data &&
                      result.data
                        .population &&
                      result.data
                        .population
                        .cleanPlayerWeekObservations !==
                        undefined
                        ? result.data
                            .population
                            .cleanPlayerWeekObservations
                        : Array.isArray(
                            result.data &&
                            result.data
                              .observations
                          )
                          ? result.data
                              .observations
                              .length
                          : null,

                    ready:
                      result.data &&
                      result.data
                        .nextStep &&
                      result.data
                        .nextStep
                        .ready ===
                        true
                  };
                }
              )
          },

          results:
            evaluated,

          control:
            rankedControl,

          bestChallenger,

          strongestPassingChallenger,

          decisionSummary: {
            challengersTested:
              challengers.length,

            challengersPassingDecisionBar:
              passingChallengers.length,

            passingCandidateKeys:
              passingChallengers.map(
                function (
                  candidate
                ) {
                  return (
                    candidate.key
                  );
                }
              ),

            evidenceSupportsProductionWeightChange:
              passingChallengers.length >
              0,

            reason:
              passingChallengers.length >
              0
                ? "At least one predetermined challenger clears the held-out decision bar against the frozen 55/40/5 control. Review the strongest passing candidate and split-by-split behavior before changing production QB weights."
                : "No predetermined challenger clears the held-out decision bar. Keep 55/40/5 frozen and investigate component construction rather than changing production weights."
          },

          participationDiagnostics:
            participationDiagnostics(
              observations
            ),

          productionWeightChange:
            null,

          nextStep: {
            ready:
              true,

            reason:
              passingChallengers.length >
              0
                ? "Held-out robustness testing is complete. Review whether the strongest passing challenger is sufficiently stable and interpretable to justify a production-weight proposal."
                : "Held-out robustness testing is complete. No challenger cleared the decision bar; keep production weights unchanged and investigate QB component design."
          },

          architecture: {
            modelVersion:
              "qb-sage-v1",

            backtestCacheStore:
              STORE_NAME,

            historicalBlocks:
              CACHED_BLOCKS,

            robustnessSplits:
              ROBUSTNESS_SPLITS,

            searchesForWeightsInsideHoldout:
              false,

            recalculatesHistoricalBacktests:
              false,

            recalculatesHistoricalComponents:
              false,

            recalculatesHistoricalOutcomes:
              false,

            writesProductionWeights:
              false,

            directTank01Calls:
              0
          },

          provenance: {
            control:
              CONTROL_KEY,

            sourceBacktest:
              "weekly-sage-qb-backtest",

            cachedBy:
              "refresh-qb-backtest-cache",

            priorSensitivity:
              "weekly-sage-qb-weight-sensitivity",

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
        "weekly-sage-qb-weight-robustness failed:",
        error
      );

      return jsonResponse(
        502,
        {
          error:
            "Could not build Weekly SAGE QB weight robustness analysis from cached backtests.",

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
