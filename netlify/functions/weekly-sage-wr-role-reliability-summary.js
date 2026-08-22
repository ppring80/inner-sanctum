// netlify/functions/weekly-sage-wr-role-reliability-summary.js
//
// WEEKLY SAGE — WR ROLE RELIABILITY SUMMARY
//
// PURPOSE
// -------
// Pool multiple already-generated weekly WR Role Reliability results
// into one multi-week reliability analysis.
//
// SOURCE EVIDENCE
// ---------------
//
//   weekly-sage-wr-role-reliability
//
// ARCHITECTURE
// ------------
// This endpoint makes ZERO downstream function calls.
//
// Weekly reliability evidence is supplied in the POST body.
//
// That avoids:
//
//   summary
//     -> reliability
//       -> backtest
//         -> validation
//           -> leaderboard / player-season / final-score
//
// which became too expensive and produced Netlify 504 timeouts.
//
// POOLING PRINCIPLE
// -----------------
// Counts are additive.
//
// Example:
//
//   Week 5 Role 85+
//     4 observations
//     4 reached 10+ PPR
//
//   Week 6 Role 85+
//     6 observations
//     5 reached 10+ PPR
//
//   Combined
//     10 observations
//     9 reached 10+ PPR
//     90%
//
// Percentages are ALWAYS recalculated from pooled counts.
//
// Average Role Score, average SAGE Score, and average PPR are
// pooled using observation-count-weighted averages.
//
// MEDIANS ARE NOT POOLED.
//
// A median cannot be reconstructed exactly from weekly medians.
// Therefore the multi-week summary intentionally does not report
// a pooled median.
//
// THIS ENDPOINT DOES NOT
// ----------------------
// - call Tank01
// - call any other Netlify function
// - rebuild historical predictions
// - alter SAGE scores
// - alter WR weights
// - alter confidence
// - create recommendation thresholds
//
// REQUEST
// -------
//
// POST JSON:
//
// {
//   "season": "2025",
//   "seasonType": "reg",
//   "weeks": [
//     { ...full weekly-sage-wr-role-reliability output... },
//     { ... },
//     { ... }
//   ]
// }
//
// ═══════════════════════════════════════════════════════════════════════

const CACHE_CONTROL =
  "no-store";

const EXPECTED_EVIDENCE_TYPE =
  "weekly-sage-wr-role-reliability";

const ROLE_BAND_ORDER = [
  "85_plus",
  "75_to_84_9",
  "65_to_74_9",
  "55_to_64_9",
  "45_to_54_9",
  "35_to_44_9",
  "below_35"
];

const ROLE_BAND_LABELS = {
  "85_plus":
    "85+",

  "75_to_84_9":
    "75-84.9",

  "65_to_74_9":
    "65-74.9",

  "55_to_64_9":
    "55-64.9",

  "45_to_54_9":
    "45-54.9",

  "35_to_44_9":
    "35-44.9",

  "below_35":
    "Below 35"
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

function percentage(
  numerator,
  denominator
) {
  if (
    !denominator
  ) {
    return null;
  }

  return round(
    (
      numerator /
      denominator
    ) *
    100,
    1
  );
}

function jsonResponse(
  statusCode,
  body
) {
  return {
    statusCode,

    headers: {
      "Content-Type":
        "application/json",

      "Cache-Control":
        CACHE_CONTROL
    },

    body:
      JSON.stringify(
        body,
        null,
        2
      )
  };
}

function safeJsonParse(
  text
) {
  try {
    return JSON.parse(
      text
    );
  } catch (
    error
  ) {
    return null;
  }
}

function emptyAccumulator(
  key
) {
  return {
    key,

    label:
      ROLE_BAND_LABELS[
        key
      ] ||
      key,

    count:
      0,

    weightedRoleScoreSum:
      0,

    weightedSageScoreSum:
      0,

    weightedActualPPRSum:
      0,

    below5:
      0,

    below10:
      0,

    atLeast10:
      0,

    atLeast12:
      0,

    atLeast15:
      0,

    atLeast20:
      0,

    atLeast25:
      0,

    contributingWeeks:
      new Set()
  };
}

function createAccumulators() {
  const accumulators =
    {};

  for (
    const key of
    ROLE_BAND_ORDER
  ) {
    accumulators[
      key
    ] =
      emptyAccumulator(
        key
      );
  }

  return accumulators;
}

function countFromMetric(
  metric
) {
  if (
    !metric ||
    typeof metric !==
      "object"
  ) {
    return null;
  }

  return nullableNum(
    metric.count
  );
}

function validateWeeklyEvidence(
  weekEvidence
) {
  if (
    !weekEvidence ||
    typeof weekEvidence !==
      "object"
  ) {
    return {
      valid:
        false,

      reason:
        "Weekly evidence must be an object."
    };
  }

  if (
    weekEvidence.evidenceType !==
    EXPECTED_EVIDENCE_TYPE
  ) {
    return {
      valid:
        false,

      reason:
        `Expected evidenceType ${EXPECTED_EVIDENCE_TYPE}.`
    };
  }

  const week =
    nullableNum(
      weekEvidence.week
    );

  if (
    week ===
      null
  ) {
    return {
      valid:
        false,

      reason:
        "Weekly evidence is missing week."
    };
  }

  if (
    !Array.isArray(
      weekEvidence.roleBands
    )
  ) {
    return {
      valid:
        false,

      reason:
        "Weekly evidence is missing roleBands."
    };
  }

  return {
    valid:
      true,

    week
  };
}

function accumulateBand({
  accumulator,
  band,
  week
}) {
  const count =
    nullableNum(
      band.count
    );

  if (
    count ===
      null ||
    count <=
      0
  ) {
    return;
  }

  const averageRoleScore =
    nullableNum(
      band.averageRoleScore
    );

  const averageSageScore =
    nullableNum(
      band.averageSageScore
    );

  const averageActualPPR =
    nullableNum(
      band.actualPPR &&
      band.actualPPR.average
    );

  const reliability =
    band.reliability ||
    {};

  const below5 =
    countFromMetric(
      reliability.below5
    );

  const below10 =
    countFromMetric(
      reliability.below10
    );

  const atLeast10 =
    countFromMetric(
      reliability.atLeast10
    );

  const atLeast12 =
    countFromMetric(
      reliability.atLeast12
    );

  const atLeast15 =
    countFromMetric(
      reliability.atLeast15
    );

  const atLeast20 =
    countFromMetric(
      reliability.atLeast20
    );

  const atLeast25 =
    countFromMetric(
      reliability.atLeast25
    );

  accumulator.count +=
    count;

  if (
    averageRoleScore !==
    null
  ) {
    accumulator
      .weightedRoleScoreSum +=
        averageRoleScore *
        count;
  }

  if (
    averageSageScore !==
    null
  ) {
    accumulator
      .weightedSageScoreSum +=
        averageSageScore *
        count;
  }

  if (
    averageActualPPR !==
    null
  ) {
    accumulator
      .weightedActualPPRSum +=
        averageActualPPR *
        count;
  }

  accumulator.below5 +=
    below5 ||
    0;

  accumulator.below10 +=
    below10 ||
    0;

  accumulator.atLeast10 +=
    atLeast10 ||
    0;

  accumulator.atLeast12 +=
    atLeast12 ||
    0;

  accumulator.atLeast15 +=
    atLeast15 ||
    0;

  accumulator.atLeast20 +=
    atLeast20 ||
    0;

  accumulator.atLeast25 +=
    atLeast25 ||
    0;

  accumulator
    .contributingWeeks
    .add(
      week
    );
}

function pooledBand(
  accumulator
) {
  const count =
    accumulator.count;

  if (
    count <=
    0
  ) {
    return {
      key:
        accumulator.key,

      label:
        accumulator.label,

      count:
        0,

      contributingWeeks:
        [],

      averageRoleScore:
        null,

      averageSageScore:
        null,

      actualPPR: {
        average:
          null,

        median:
          null,

        medianStatus:
          "Not poolable from weekly summary evidence."
      },

      reliability: {
        below5: {
          count:
            0,

          percent:
            null
        },

        below10: {
          count:
            0,

          percent:
            null
        },

        atLeast10: {
          count:
            0,

          percent:
            null
        },

        atLeast12: {
          count:
            0,

          percent:
            null
        },

        atLeast15: {
          count:
            0,

          percent:
            null
        },

        atLeast20: {
          count:
            0,

          percent:
            null
        },

        atLeast25: {
          count:
            0,

          percent:
            null
        }
      },

      reliabilityScore:
        null
    };
  }

  const atLeast10Pct =
    percentage(
      accumulator.atLeast10,
      count
    );

  const atLeast12Pct =
    percentage(
      accumulator.atLeast12,
      count
    );

  const avoidBelow5Pct =
    percentage(
      count -
      accumulator.below5,
      count
    );

  /*
    Same diagnostic formula as the weekly endpoint.

    Still diagnostic only.

      50% >=10 PPR rate
      30% >=12 PPR rate
      20% avoidance of <5 PPR
  */
  const reliabilityScore =
    round(
      (
        atLeast10Pct *
        0.50
      ) +
      (
        atLeast12Pct *
        0.30
      ) +
      (
        avoidBelow5Pct *
        0.20
      ),
      1
    );

  return {
    key:
      accumulator.key,

    label:
      accumulator.label,

    count,

    contributingWeeks:
      Array.from(
        accumulator
          .contributingWeeks
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
        ),

    averageRoleScore:
      round(
        accumulator
          .weightedRoleScoreSum /
        count,
        1
      ),

    averageSageScore:
      round(
        accumulator
          .weightedSageScoreSum /
        count,
        1
      ),

    actualPPR: {
      average:
        round(
          accumulator
            .weightedActualPPRSum /
          count,
          2
        ),

      median:
        null,

      medianStatus:
        "Not poolable exactly from weekly summary evidence."
    },

    reliability: {
      below5: {
        count:
          accumulator.below5,

        percent:
          percentage(
            accumulator.below5,
            count
          )
      },

      below10: {
        count:
          accumulator.below10,

        percent:
          percentage(
            accumulator.below10,
            count
          )
      },

      atLeast10: {
        count:
          accumulator.atLeast10,

        percent:
          atLeast10Pct
      },

      atLeast12: {
        count:
          accumulator.atLeast12,

        percent:
          atLeast12Pct
      },

      atLeast15: {
        count:
          accumulator.atLeast15,

        percent:
          percentage(
            accumulator.atLeast15,
            count
          )
      },

      atLeast20: {
        count:
          accumulator.atLeast20,

        percent:
          percentage(
            accumulator.atLeast20,
            count
          )
      },

      atLeast25: {
        count:
          accumulator.atLeast25,

        percent:
          percentage(
            accumulator.atLeast25,
            count
          )
      }
    },

    reliabilityScore
  };
}

function monotonicComparison(
  bands,
  selector,
  direction
) {
  const populated =
    bands.filter(
      function (
        band
      ) {
        return (
          band.count >
            0 &&
          nullableNum(
            selector(
              band
            )
          ) !==
            null
        );
      }
    );

  if (
    populated.length <
    2
  ) {
    return {
      comparisons:
        0,

      aligned:
        0,

      rate:
        null,

      percent:
        null
    };
  }

  let comparisons =
    0;

  let aligned =
    0;

  for (
    let i =
      0;
    i <
      populated.length -
        1;
    i +=
      1
  ) {
    const higherRole =
      nullableNum(
        selector(
          populated[
            i
          ]
        )
      );

    const lowerRole =
      nullableNum(
        selector(
          populated[
            i +
            1
          ]
        )
      );

    if (
      higherRole ===
        null ||
      lowerRole ===
        null
    ) {
      continue;
    }

    comparisons +=
      1;

    if (
      direction ===
      "higher"
    ) {
      if (
        higherRole >=
        lowerRole
      ) {
        aligned +=
          1;
      }
    } else {
      if (
        higherRole <=
        lowerRole
      ) {
        aligned +=
          1;
      }
    }
  }

  return {
    comparisons,

    aligned,

    rate:
      comparisons >
        0
        ? round(
            aligned /
            comparisons,
            3
          )
        : null,

    percent:
      comparisons >
        0
        ? round(
            (
              aligned /
              comparisons
            ) *
            100,
            1
          )
        : null
  };
}

function buildReliabilityTest(
  bands
) {
  return {
    averagePPRDeclinesWithRole:
      monotonicComparison(
        bands,

        function (
          band
        ) {
          return (
            band.actualPPR
              .average
          );
        },

        "higher"
      ),

    tenPlusRateDeclinesWithRole:
      monotonicComparison(
        bands,

        function (
          band
        ) {
          return (
            band.reliability
              .atLeast10
              .percent
          );
        },

        "higher"
      ),

    twelvePlusRateDeclinesWithRole:
      monotonicComparison(
        bands,

        function (
          band
        ) {
          return (
            band.reliability
              .atLeast12
              .percent
          );
        },

        "higher"
      ),

    fifteenPlusRateDeclinesWithRole:
      monotonicComparison(
        bands,

        function (
          band
        ) {
          return (
            band.reliability
              .atLeast15
              .percent
          );
        },

        "higher"
      ),

    twentyPlusRateDeclinesWithRole:
      monotonicComparison(
        bands,

        function (
          band
        ) {
          return (
            band.reliability
              .atLeast20
              .percent
          );
        },

        "higher"
      ),

    bustRateRisesAsRoleDeclines:
      monotonicComparison(
        bands,

        function (
          band
        ) {
          return (
            band.reliability
              .below10
              .percent
          );
        },

        "lower"
      ),

    severeBustRateRisesAsRoleDeclines:
      monotonicComparison(
        bands,

        function (
          band
        ) {
          return (
            band.reliability
              .below5
              .percent
          );
        },

        "lower"
      ),

    diagnosticReliabilityScoreDeclinesWithRole:
      monotonicComparison(
        bands,

        function (
          band
        ) {
          return (
            band.reliabilityScore
          );
        },

        "higher"
      )
  };
}

function sampleAssessment(
  bands
) {
  const preferredMinimum =
    25;

  const belowPreferred =
    bands
      .filter(
        function (
          band
        ) {
          return (
            band.count >
              0 &&
            band.count <
              preferredMinimum
          );
        }
      )
      .map(
        function (
          band
        ) {
          return {
            band:
              band.label,

            count:
              band.count
          };
        }
      );

  return {
    preferredMinimumPlayerWeeksPerBand:
      preferredMinimum,

    bandsBelowPreferredSample:
      belowPreferred,

    allBandsAtPreferredSample:
      belowPreferred.length ===
        0,

    caution:
      belowPreferred.length >
        0
        ? "One or more pooled Role bands remain below the preferred 25 player-week diagnostic sample. Treat those individual percentages as directional."
        : null
  };
}

function buildInterpretation(
  reliabilityTest,
  pooledBands
) {
  const usable =
    reliabilityTest
      .twelvePlusRateDeclinesWithRole;

  const bust =
    reliabilityTest
      .bustRateRisesAsRoleDeclines;

  const diagnostic =
    reliabilityTest
      .diagnosticReliabilityScoreDeclinesWithRole;

  const topBand =
    pooledBands.find(
      function (
        band
      ) {
        return (
          band.count >
          0
        );
      }
    );

  const bottomBand =
    [
      ...pooledBands
    ]
      .reverse()
      .find(
        function (
          band
        ) {
          return (
            band.count >
            0
          );
        }
      );

  let signal =
    "inconclusive";

  if (
    usable &&
    bust &&
    diagnostic &&
    usable.rate !==
      null &&
    bust.rate !==
      null &&
    diagnostic.rate !==
      null
  ) {
    const averageAlignment =
      (
        usable.rate +
        bust.rate +
        diagnostic.rate
      ) /
      3;

    if (
      averageAlignment >=
      0.80
    ) {
      signal =
        "strong_directional_support";
    } else if (
      averageAlignment >=
      0.60
    ) {
      signal =
        "moderate_directional_support";
    } else if (
      averageAlignment >=
      0.40
    ) {
      signal =
        "mixed";
    } else {
      signal =
        "weak_or_contradictory";
    }
  }

  return {
    signal,

    highRoleBand:
      topBand
        ? {
            label:
              topBand.label,

            count:
              topBand.count,

            below10Pct:
              topBand
                .reliability
                .below10
                .percent,

            atLeast12Pct:
              topBand
                .reliability
                .atLeast12
                .percent,

            reliabilityScore:
              topBand
                .reliabilityScore
          }
        : null,

    lowRoleBand:
      bottomBand
        ? {
            label:
              bottomBand.label,

            count:
              bottomBand.count,

            below10Pct:
              bottomBand
                .reliability
                .below10
                .percent,

            atLeast12Pct:
              bottomBand
                .reliability
                .atLeast12
                .percent,

            reliabilityScore:
              bottomBand
                .reliabilityScore
          }
        : null,

    important:
      "This interpretation describes historical Role reliability only. It does not modify SAGE or establish recommendation thresholds."
  };
}

exports.handler =
  async function (
    event
  ) {
    if (
      event.httpMethod !==
      "POST"
    ) {
      return jsonResponse(
        405,
        {
          error:
            "Method not allowed.",

          detail:
            "weekly-sage-wr-role-reliability-summary requires POST.",

          expectedBody: {
            season:
              "2025",

            seasonType:
              "reg",

            weeks: [
              {
                evidenceType:
                  "weekly-sage-wr-role-reliability",

                week:
                  5,

                roleBands:
                  "..."
              }
            ]
          }
        }
      );
    }

    const body =
      safeJsonParse(
        event.body ||
        ""
      );

    if (
      !body ||
      typeof body !==
        "object"
    ) {
      return jsonResponse(
        400,
        {
          error:
            "Request body must be valid JSON."
        }
      );
    }

    const season =
      String(
        body.season ||
        ""
      ).trim();

    const seasonType =
      String(
        body.seasonType ||
        "reg"
      ).trim();

    const weeks =
      Array.isArray(
        body.weeks
      )
        ? body.weeks
        : [];

    if (
      !season
    ) {
      return jsonResponse(
        400,
        {
          error:
            "season is required."
        }
      );
    }

    if (
      weeks.length ===
      0
    ) {
      return jsonResponse(
        400,
        {
          error:
            "weeks must contain at least one weekly reliability result."
        }
      );
    }

    const accumulators =
      createAccumulators();

    const acceptedWeeks =
      [];

    const rejectedWeeks =
      [];

    const duplicateWeeks =
      [];

    const seenWeeks =
      new Set();

    let totalInputObservations =
      0;

    for (
      let index =
        0;
      index <
        weeks.length;
      index +=
        1
    ) {
      const weeklyEvidence =
        weeks[
          index
        ];

      const validation =
        validateWeeklyEvidence(
          weeklyEvidence
        );

      if (
        !validation.valid
      ) {
        rejectedWeeks.push({
          index,

          week:
            weeklyEvidence &&
            weeklyEvidence.week !==
              undefined
              ? weeklyEvidence.week
              : null,

          reason:
            validation.reason
        });

        continue;
      }

      const week =
        validation.week;

      if (
        seenWeeks.has(
          week
        )
      ) {
        duplicateWeeks.push(
          week
        );

        continue;
      }

      seenWeeks.add(
        week
      );

      const evidenceSeason =
        weeklyEvidence.season !==
          undefined
          ? String(
              weeklyEvidence.season
            )
          : season;

      if (
        evidenceSeason !==
        season
      ) {
        rejectedWeeks.push({
          index,

          week,

          reason:
            `Season mismatch. Expected ${season}, received ${evidenceSeason}.`
        });

        continue;
      }

      const evidenceSeasonType =
        weeklyEvidence.seasonType ||
        seasonType;

      if (
        String(
          evidenceSeasonType
        ) !==
        seasonType
      ) {
        rejectedWeeks.push({
          index,

          week,

          reason:
            `seasonType mismatch. Expected ${seasonType}, received ${evidenceSeasonType}.`
        });

        continue;
      }

      let weeklyObservationCount =
        0;

      for (
        const band of
        weeklyEvidence.roleBands
      ) {
        if (
          !band ||
          !ROLE_BAND_ORDER.includes(
            band.key
          )
        ) {
          continue;
        }

        const count =
          nullableNum(
            band.count
          ) ||
          0;

        weeklyObservationCount +=
          count;

        accumulateBand({
          accumulator:
            accumulators[
              band.key
            ],

          band,

          week
        });
      }

      totalInputObservations +=
        weeklyObservationCount;

      acceptedWeeks.push({
        week,

        observations:
          weeklyObservationCount,

        generatedAt:
          weeklyEvidence.generatedAt ||
          null
      });
    }

    acceptedWeeks.sort(
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

    if (
      acceptedWeeks.length ===
      0
    ) {
      return jsonResponse(
        422,
        {
          error:
            "No valid weekly reliability evidence was accepted.",

          rejectedWeeks,

          duplicateWeeks
        }
      );
    }

    const pooledRoleBands =
      ROLE_BAND_ORDER.map(
        function (
          key
        ) {
          return pooledBand(
            accumulators[
              key
            ]
          );
        }
      );

    const pooledCount =
      pooledRoleBands.reduce(
        function (
          sum,
          band
        ) {
          return (
            sum +
            band.count
          );
        },
        0
      );

    const reliabilityTest =
      buildReliabilityTest(
        pooledRoleBands
      );

    const sampleSize =
      sampleAssessment(
        pooledRoleBands
      );

    const interpretation =
      buildInterpretation(
        reliabilityTest,
        pooledRoleBands
      );

    const clean =
      rejectedWeeks.length ===
        0 &&
      duplicateWeeks.length ===
        0 &&
      pooledCount ===
        totalInputObservations;

    return jsonResponse(
      200,
      {
        evidenceType:
          "weekly-sage-wr-role-reliability-summary",

        schemaVersion:
          1,

        generatedAt:
          new Date()
            .toISOString(),

        season,

        seasonType,

        methodology: {
          modelVersion:
            "wr-sage-v1",

          analysisVersion:
            "wr-role-reliability-summary-v1",

          hypothesis:
            "Higher pre-game WR Role corresponds to a more dependable fantasy floor and a greater probability of producing a usable weekly PPR result.",

          aggregation:
            "Weekly Role-band counts are pooled across accepted weeks. Percentages are recalculated from pooled counts rather than averaging weekly percentages.",

          weightedAverages:
            "Average Role Score, SAGE Score, and actual PPR are pooled using weekly Role-band observation counts.",

          medianHandling:
            "Weekly medians are not pooled because an exact pooled median cannot be reconstructed from summary-level medians.",

          diagnosticReliabilityScore:
            "50% >=10 PPR rate + 30% >=12 PPR rate + 20% avoidance of <5 PPR.",

          important:
            "This endpoint consumes already-generated evidence and makes zero downstream function calls. It does not alter Weekly SAGE."
        },

        population: {
          weeksSubmitted:
            weeks.length,

          weeksAccepted:
            acceptedWeeks.length,

          weeksRejected:
            rejectedWeeks.length,

          duplicateWeeks:
            duplicateWeeks.length,

          pooledPlayerWeekObservations:
            pooledCount,

          sourceObservationCount:
            totalInputObservations,

          clean
        },

        acceptedWeeks,

        pooledRoleBands,

        reliabilityTest,

        sampleSize,

        interpretation,

        diagnostics: {
          rejectedWeeks,

          duplicateWeeks
        },

        recommendation:
          null,

        nextStep: {
          ready:
            clean &&
            pooledCount >
              0,

          reason:
            clean &&
            pooledCount >
              0
              ? "The supplied weekly WR Role Reliability evidence was pooled successfully without rebuilding historical player evidence. Continue adding independently generated weeks until Role-band sample sizes are large enough to determine whether Role should influence WR recommendation reliability."
              : "Resolve rejected, duplicate, or observation-count discrepancies before interpreting the pooled reliability evidence."
        },

        architecture: {
          modelVersion:
            "wr-sage-v1",

          analysisVersion:
            "wr-role-reliability-summary-v1",

          downstreamFunctionCalls:
            0,

          directTank01Calls:
            0,

          recalculatesHistoricalSage:
            false,

          changesSageWeights:
            false,

          changesRecommendations:
            false
        },

        provenance: {
          source:
            "weekly-sage-wr-role-reliability",

          aggregation:
            "Pooled weekly Role-band counts",

          outcomes:
            "Historical PPR results already contained in supplied weekly reliability evidence"
        }
      }
    );
  };
