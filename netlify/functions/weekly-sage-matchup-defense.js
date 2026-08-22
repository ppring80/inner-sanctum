// netlify/functions/weekly-sage-matchup-defense.js
//
// WEEKLY SAGE — DEFENSIVE MATCHUP INTELLIGENCE
//
// PURPOSE
// -------
// Convert validated season-to-date defensive evidence into
// league-relative matchup signals.
//
// Example:
//   ?season=2025&week=8
//
// IMPORTANT:
// - Week 8 recommendations use Weeks 1-7 evidence.
// - This function does NOT rank fantasy players.
// - This function does NOT produce START/SIT decisions.
// - This function does NOT modify weekly.html.
// - Matchup is evidence, not the final SAGE decision.
//
// SIGNAL SCALE
// ------------
// strong_positive = opponent is among the most favorable defenses to attack
// positive        = favorable
// neutral         = middle of league
// negative        = difficult
// strong_negative = among the most difficult defenses to attack
//
// Positive ALWAYS means favorable for the OFFENSIVE fantasy player.
//
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_SEASON_TYPE = "reg";

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

const MIN_GAMES_FOR_FULL_CONFIDENCE = 4;

const TEAM_NAMES = {
  ARI: "Arizona",
  ATL: "Atlanta",
  BAL: "Baltimore",
  BUF: "Buffalo",
  CAR: "Carolina",
  CHI: "Chicago",
  CIN: "Cincinnati",
  CLE: "Cleveland",
  DAL: "Dallas",
  DEN: "Denver",
  DET: "Detroit",
  GB: "Green Bay",
  HOU: "Houston",
  IND: "Indianapolis",
  JAX: "Jacksonville",
  KC: "Kansas City",
  LAC: "Los Angeles Chargers",
  LAR: "Los Angeles Rams",
  LV: "Las Vegas",
  MIA: "Miami",
  MIN: "Minnesota",
  NE: "New England",
  NO: "New Orleans",
  NYG: "New York Giants",
  NYJ: "New York Jets",
  PHI: "Philadelphia",
  PIT: "Pittsburgh",
  SEA: "Seattle",
  SF: "San Francisco",
  TB: "Tampa Bay",
  TEN: "Tennessee",
  WSH: "Washington"
};

/*
  Metric weights intentionally sum to 1.00.

  We use both:
    VOLUME     — how much production a defense permits
    EFFICIENCY — how efficiently opponents produce it
    SCORING    — touchdown allowance

  This avoids allowing one noisy statistic to completely define a
  matchup.
*/

const RUN_METRICS = [
  {
    path: ["perGame", "rushYardsAllowed"],
    weight: 0.40,
    direction: "higher_is_easier"
  },
  {
    path: ["runDefense", "yardsPerCarryAllowed"],
    weight: 0.30,
    direction: "higher_is_easier"
  },
  {
    path: ["perGame", "rushTDAllowed"],
    weight: 0.20,
    direction: "higher_is_easier"
  },
  {
    path: ["perGame", "rushAttemptsAllowed"],
    weight: 0.10,
    direction: "higher_is_easier"
  }
];

const PASS_METRICS = [
  {
    path: ["perGame", "passYardsAllowed"],
    weight: 0.35,
    direction: "higher_is_easier"
  },
  {
    path: ["passDefense", "yardsPerAttemptAllowed"],
    weight: 0.25,
    direction: "higher_is_easier"
  },
  {
    path: ["perGame", "passTDAllowed"],
    weight: 0.20,
    direction: "higher_is_easier"
  },
  {
    path: ["passDefense", "completionPctAllowed"],
    weight: 0.10,
    direction: "higher_is_easier"
  },
  {
    path: ["perGame", "sacks"],
    weight: 0.05,
    direction: "higher_is_harder"
  },
  {
    path: ["perGame", "interceptions"],
    weight: 0.05,
    direction: "higher_is_harder"
  }
];

function numberValue(value) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : 0;
}

function getPath(object, path) {
  let value = object;

  for (const key of path) {
    if (
      value === undefined ||
      value === null
    ) {
      return 0;
    }

    value = value[key];
  }

  return numberValue(value);
}

function mean(values) {
  if (!values.length) {
    return 0;
  }

  return (
    values.reduce(
      (sum, value) => sum + value,
      0
    ) / values.length
  );
}

function median(values) {
  if (!values.length) {
    return 0;
  }

  const sorted =
    [...values].sort(
      (a, b) => a - b
    );

  const middle =
    Math.floor(
      sorted.length / 2
    );

  if (
    sorted.length % 2 === 0
  ) {
    return (
      (
        sorted[middle - 1] +
        sorted[middle]
      ) / 2
    );
  }

  return sorted[middle];
}

function percentileRank(
  value,
  leagueValues
) {
  if (
    !Array.isArray(leagueValues) ||
    leagueValues.length <= 1
  ) {
    return 50;
  }

  let below = 0;
  let equal = 0;

  for (
    const leagueValue of
    leagueValues
  ) {
    if (leagueValue < value) {
      below += 1;
    } else if (
      leagueValue === value
    ) {
      equal += 1;
    }
  }

  const percentile =
    (
      below +
      (equal - 1) / 2
    ) /
    (leagueValues.length - 1);

  return Number(
    (
      percentile * 100
    ).toFixed(1)
  );
}

function metricScore({
  value,
  leagueValues,
  direction
}) {
  const percentile =
    percentileRank(
      value,
      leagueValues
    );

  if (
    direction ===
    "higher_is_harder"
  ) {
    return Number(
      (
        100 - percentile
      ).toFixed(1)
    );
  }

  return percentile;
}

function signalFromScore(score) {
  if (score >= 80) {
    return "strong_positive";
  }

  if (score >= 60) {
    return "positive";
  }

  if (score > 40) {
    return "neutral";
  }

  if (score > 20) {
    return "negative";
  }

  return "strong_negative";
}

function signalLabel(signal) {
  switch (signal) {
    case "strong_positive":
      return "Strong Positive";

    case "positive":
      return "Positive";

    case "negative":
      return "Negative";

    case "strong_negative":
      return "Strong Negative";

    default:
      return "Neutral";
  }
}

function matchupOpening(
  signal,
  type
) {
  const label =
    type === "run"
      ? "rushing"
      : "passing";

  switch (signal) {
    case "strong_positive":
      return `Excellent ${label} matchup.`;

    case "positive":
      return `Favorable ${label} matchup.`;

    case "negative":
      return `Difficult ${label} matchup.`;

    case "strong_negative":
      return `Very difficult ${label} matchup.`;

    default:
      return `Neutral ${label} matchup.`;
  }
}

function teamDisplayName(team) {
  return (
    TEAM_NAMES[team] ||
    team
  );
}

function earlySeasonQualifier(
  confidence,
  games
) {
  if (
    !confidence ||
    confidence.level === "full"
  ) {
    return "";
  }

  return (
    ` Early-season sample: based on ${games} ` +
    `game${games === 1 ? "" : "s"}.`
  );
}

function percentilePhrase(
  percentile,
  favorableType
) {
  if (percentile >= 90) {
    return favorableType === "positive"
      ? "among the most favorable marks in the league"
      : "among the strongest marks in the league";
  }

  if (percentile >= 75) {
    return favorableType === "positive"
      ? "well above the league norm for offensive opportunity"
      : "well above the league norm defensively";
  }

  if (percentile <= 10) {
    return favorableType === "positive"
      ? "among the least favorable marks in the league"
      : "among the weakest marks in the league";
  }

  if (percentile <= 25) {
    return favorableType === "positive"
      ? "below the league norm for offensive opportunity"
      : "below the league norm defensively";
  }

  return "near the league norm";
}

function findComponent(
  profile,
  metric
) {
  if (
    !profile ||
    !Array.isArray(
      profile.components
    )
  ) {
    return null;
  }

  return (
    profile.components.find(
      component =>
        component.metric === metric
    ) ||
    null
  );
}

function buildRunExplanation({
  team,
  run,
  defense
}) {
  const displayName =
    teamDisplayName(team);

  const games =
    numberValue(
      defense.games
    );

  const rushYards =
    numberValue(
      defense.perGame &&
      defense.perGame
        .rushYardsAllowed
    );

  const yardsPerCarry =
    numberValue(
      defense.runDefense &&
      defense.runDefense
        .yardsPerCarryAllowed
    );

  const rushTD =
    numberValue(
      defense.perGame &&
      defense.perGame
        .rushTDAllowed
    );

  const rushYardsComponent =
    findComponent(
      run,
      "perGame.rushYardsAllowed"
    );

  const ypcComponent =
    findComponent(
      run,
      "runDefense.yardsPerCarryAllowed"
    );

  const opening =
    matchupOpening(
      run.signal,
      "run"
    );

  let detail = "";

  if (
    run.signal === "strong_positive" ||
    run.signal === "positive"
  ) {
    const rushYardsPhrase =
      rushYardsComponent
        ? percentilePhrase(
            rushYardsComponent
              .favorablePercentile,
            "positive"
          )
        : "a favorable league-relative mark";

    const ypcPhrase =
      ypcComponent
        ? percentilePhrase(
            ypcComponent
              .favorablePercentile,
            "positive"
          )
        : "a favorable league-relative mark";

    detail =
      `${displayName} has allowed ${rushYards.toFixed(1)} rushing yards ` +
      `per game and ${yardsPerCarry.toFixed(2)} yards per carry. ` +
      `Those measures are ${rushYardsPhrase} and ${ypcPhrase}, respectively.`;

    if (rushTD >= 1) {
      detail +=
        ` The defense has also allowed ${rushTD.toFixed(2)} rushing ` +
        `touchdowns per game.`;
    }
  } else if (
    run.signal === "strong_negative" ||
    run.signal === "negative"
  ) {
    detail =
      `${displayName} has allowed only ${rushYards.toFixed(1)} rushing yards ` +
      `per game and ${yardsPerCarry.toFixed(2)} yards per carry, indicating ` +
      `a stronger-than-average run defense.`;

    if (rushTD < 1) {
      detail +=
        ` It has allowed ${rushTD.toFixed(2)} rushing touchdowns per game.`;
    }
  } else {
    detail =
      `${displayName} has allowed ${rushYards.toFixed(1)} rushing yards ` +
      `per game and ${yardsPerCarry.toFixed(2)} yards per carry, placing ` +
      `the matchup near the middle of the league.`;
  }

  return (
    `${opening} ${detail}` +
    earlySeasonQualifier(
      run.confidence,
      games
    )
  );
}

function buildPassExplanation({
  team,
  pass,
  defense
}) {
  const displayName =
    teamDisplayName(team);

  const games =
    numberValue(
      defense.games
    );

  const passYards =
    numberValue(
      defense.perGame &&
      defense.perGame
        .passYardsAllowed
    );

  const yardsPerAttempt =
    numberValue(
      defense.passDefense &&
      defense.passDefense
        .yardsPerAttemptAllowed
    );

  const passTD =
    numberValue(
      defense.perGame &&
      defense.perGame
        .passTDAllowed
    );

  const sacks =
    numberValue(
      defense.perGame &&
      defense.perGame.sacks
    );

  const interceptions =
    numberValue(
      defense.perGame &&
      defense.perGame
        .interceptions
    );

  const passYardsComponent =
    findComponent(
      pass,
      "perGame.passYardsAllowed"
    );

  const ypaComponent =
    findComponent(
      pass,
      "passDefense.yardsPerAttemptAllowed"
    );

  const sacksComponent =
    findComponent(
      pass,
      "perGame.sacks"
    );

  const interceptionsComponent =
    findComponent(
      pass,
      "perGame.interceptions"
    );

  const opening =
    matchupOpening(
      pass.signal,
      "pass"
    );

  let detail = "";

  if (
    pass.signal === "strong_positive" ||
    pass.signal === "positive"
  ) {
    detail =
      `${displayName} has allowed ${passYards.toFixed(1)} passing yards ` +
      `and ${passTD.toFixed(2)} passing touchdowns per game while ` +
      `surrendering ${yardsPerAttempt.toFixed(2)} yards per attempt.`;

    const yardsHighlyFavorable =
      passYardsComponent &&
      passYardsComponent
        .favorablePercentile >= 80;

    const efficiencyHighlyFavorable =
      ypaComponent &&
      ypaComponent
        .favorablePercentile >= 80;

    if (
      yardsHighlyFavorable &&
      efficiencyHighlyFavorable
    ) {
      detail +=
        " Both volume and efficiency point to one of the league's more favorable passing environments.";
    } else if (
      yardsHighlyFavorable
    ) {
      detail +=
        " Passing volume allowed has been especially favorable relative to the league.";
    } else if (
      efficiencyHighlyFavorable
    ) {
      detail +=
        " Opposing passing attacks have also produced efficiently relative to the league.";
    }
  } else if (
    pass.signal === "strong_negative" ||
    pass.signal === "negative"
  ) {
    detail =
      `${displayName} has allowed only ${passYards.toFixed(1)} passing yards ` +
      `per game and ${yardsPerAttempt.toFixed(2)} yards per attempt, ` +
      `indicating a stronger-than-average pass defense.`;

    const strongSackPressure =
      sacksComponent &&
      sacksComponent
        .favorablePercentile <= 20;

    const strongTurnoverPressure =
      interceptionsComponent &&
      interceptionsComponent
        .favorablePercentile <= 20;

    if (strongSackPressure) {
      detail +=
        ` The defense is also producing ${sacks.toFixed(2)} sacks per game.`;
    }

    if (strongTurnoverPressure) {
      detail +=
        ` It is averaging ${interceptions.toFixed(2)} interceptions per game.`;
    }
  } else {
    detail =
      `${displayName} has allowed ${passYards.toFixed(1)} passing yards ` +
      `per game, ${passTD.toFixed(2)} passing touchdowns per game, and ` +
      `${yardsPerAttempt.toFixed(2)} yards per attempt, producing a ` +
      `league-average overall passing matchup.`;
  }

  return (
    `${opening} ${detail}` +
    earlySeasonQualifier(
      pass.confidence,
      games
    )
  );
}

function confidenceFromGames(games) {
  if (games >= MIN_GAMES_FOR_FULL_CONFIDENCE) {
    return {
      level: "full",
      weight: 1
    };
  }

  if (games === 3) {
    return {
      level: "building",
      weight: 0.85
    };
  }

  if (games === 2) {
    return {
      level: "limited",
      weight: 0.70
    };
  }

  if (games === 1) {
    return {
      level: "very_limited",
      weight: 0.50
    };
  }

  return {
    level: "none",
    weight: 0
  };
}

function applyConfidence(
  rawScore,
  confidence
) {
  return Number(
    (
      50 +
      (
        rawScore - 50
      ) *
      confidence.weight
    ).toFixed(1)
  );
}

function buildLeagueMetricValues(
  defenses,
  metrics
) {
  const result = {};

  for (
    const metric of metrics
  ) {
    const key =
      metric.path.join(".");

    result[key] =
      Object.values(defenses)
        .filter(
          defense =>
            numberValue(
              defense.games
            ) > 0
        )
        .map(
          defense =>
            getPath(
              defense,
              metric.path
            )
        );
  }

  return result;
}

function buildProfileScore({
  defense,
  metrics,
  leagueMetricValues
}) {
  const components = [];

  let weightedScore = 0;
  let totalWeight = 0;

  for (
    const metric of metrics
  ) {
    const key =
      metric.path.join(".");

    const value =
      getPath(
        defense,
        metric.path
      );

    const leagueValues =
      leagueMetricValues[key] ||
      [];

    const score =
      metricScore({
        value,
        leagueValues,
        direction:
          metric.direction
      });

    weightedScore +=
      score * metric.weight;

    totalWeight +=
      metric.weight;

    components.push({
      metric: key,
      value,
      leagueAverage:
        Number(
          mean(
            leagueValues
          ).toFixed(2)
        ),
      leagueMedian:
        Number(
          median(
            leagueValues
          ).toFixed(2)
        ),
      favorablePercentile:
        score,
      weight:
        metric.weight
    });
  }

  const rawScore =
    totalWeight > 0
      ? Number(
          (
            weightedScore /
            totalWeight
          ).toFixed(1)
        )
      : 50;

  const confidence =
    confidenceFromGames(
      numberValue(
        defense.games
      )
    );

  const score =
    applyConfidence(
      rawScore,
      confidence
    );

  const signal =
    signalFromScore(score);

  return {
    score,
    rawScore,
    signal,
    label:
      signalLabel(signal),
    confidence,
    components
  };
}

function buildExplanation({
  team,
  run,
  pass,
  defense
}) {
  return {
    run:
      buildRunExplanation({
        team,
        run,
        defense
      }),

    pass:
      buildPassExplanation({
        team,
        pass,
        defense
      })
  };
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

async function fetchSeasonEvidence({
  baseUrl,
  season,
  week,
  seasonType
}) {
  const url =
    `${baseUrl}/.netlify/functions/weekly-sage-defense-season` +
    `?season=${encodeURIComponent(season)}` +
    `&week=${encodeURIComponent(week)}` +
    `&seasonType=${encodeURIComponent(seasonType)}`;

  const response =
    await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    });

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
      `Season evidence failed: ${detail}`
    );
  }

  if (
    !data ||
    data.evidenceType !==
      "weekly-sage-defense-season"
  ) {
    throw new Error(
      "Unexpected season evidence schema."
    );
  }

  return data;
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
        cacheControl || "no-store"
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
      event.queryStringParameters ||
      {};

    const season =
      String(
        query.season ||
        new Date().getFullYear()
      );

    const week =
      Number(
        query.week
      );

    const seasonType =
      String(
        query.seasonType ||
        DEFAULT_SEASON_TYPE
      );

    if (
      !Number.isInteger(week) ||
      week < 1 ||
      week > 18
    ) {
      return jsonResponse(
        400,
        {
          error:
            "week must be an integer from 1 through 18."
        }
      );
    }

    if (
      ![
        "reg",
        "pre",
        "post",
        "all"
      ].includes(seasonType)
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
        getBaseUrl(event);

      const evidence =
        await fetchSeasonEvidence({
          baseUrl,
          season,
          week,
          seasonType
        });

      const defenses =
        evidence.defenses ||
        {};

      if (
        Object.keys(defenses)
          .length === 0
      ) {
        return jsonResponse(
          200,
          {
            evidenceType:
              "weekly-sage-matchup-defense",

            schemaVersion:
              1,

            generatedAt:
              new Date()
                .toISOString(),

            season,

            targetWeek:
              week,

            seasonType,

            weeksIncluded:
              evidence.weeksIncluded ||
              [],

            methodology: {
              basis:
                "league-relative percentile scoring",

              earlySeasonAdjustment:
                "low-sample scores are shrunk toward league-neutral 50",

              positiveMeaning:
                "favorable for the offensive fantasy player"
            },

            matchups:
              {}
          },

          CACHE_CONTROL
        );
      }

      const runLeagueValues =
        buildLeagueMetricValues(
          defenses,
          RUN_METRICS
        );

      const passLeagueValues =
        buildLeagueMetricValues(
          defenses,
          PASS_METRICS
        );

      const matchups = {};

      Object
        .keys(defenses)
        .sort()
        .forEach(
          function (team) {
            const defense =
              defenses[team];

            const run =
              buildProfileScore({
                defense,
                metrics:
                  RUN_METRICS,
                leagueMetricValues:
                  runLeagueValues
              });

            const pass =
              buildProfileScore({
                defense,
                metrics:
                  PASS_METRICS,
                leagueMetricValues:
                  passLeagueValues
              });

            /*
              Version 1 intentionally keeps receiving aligned with the
              overall pass-defense signal.

              Once our Tank01 positional evidence layer is complete,
              WR and TE will receive their own position-specific
              defensive profiles.
            */
            const receiving = {
              ...pass,
              source:
                "overall_pass_defense_v1"
            };

            matchups[team] = {
              team,

              games:
                numberValue(
                  defense.games
                ),

              run,

              pass,

              receiving,

              explanation:
                buildExplanation({
                  team,
                  run,
                  pass,
                  defense
                }),

              rawEvidence: {
                runDefense:
                  defense.runDefense,

                passDefense:
                  defense.passDefense,

                perGame:
                  defense.perGame
              }
            };
          }
        );

      return jsonResponse(
        200,
        {
          evidenceType:
            "weekly-sage-matchup-defense",

          schemaVersion:
            1,

          generatedAt:
            new Date()
              .toISOString(),

          season,

          targetWeek:
            week,

          seasonType,

          weeksIncluded:
            evidence.weeksIncluded ||
            [],

          methodology: {
            basis:
              "league-relative percentile scoring",

            runWeights: {
              rushYardsAllowedPerGame:
                0.40,

              yardsPerCarryAllowed:
                0.30,

              rushTDAllowedPerGame:
                0.20,

              rushAttemptsAllowedPerGame:
                0.10
            },

            passWeights: {
              passYardsAllowedPerGame:
                0.35,

              yardsPerAttemptAllowed:
                0.25,

              passTDAllowedPerGame:
                0.20,

              completionPctAllowed:
                0.10,

              sacksPerGame:
                0.05,

              interceptionsPerGame:
                0.05
            },

            thresholds: {
              strongPositive:
                "80-100",

              positive:
                "60-79.9",

              neutral:
                "40.1-59.9",

              negative:
                "20.1-40",

              strongNegative:
                "0-20"
            },

            earlySeasonAdjustment:
              "Scores from fewer than four games are shrunk toward league-neutral 50.",

            positiveMeaning:
              "A higher score means a more favorable matchup for the offensive fantasy player."
          },

          matchups
        },

        CACHE_CONTROL
      );
    } catch (error) {
      console.error(
        "weekly-sage-matchup-defense failed:",
        error
      );

      return jsonResponse(
        502,
        {
          error:
            "Could not build Weekly SAGE defensive matchup intelligence.",

          detail:
            error.message
        }
      );
    }
  };
