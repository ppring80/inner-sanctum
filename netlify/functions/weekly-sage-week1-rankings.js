// netlify/functions/weekly-sage-week1-rankings.js
//
// WEEKLY SAGE — WEEK 1 BASELINE RANKINGS
//
// PURPOSE
// -------
// Produce useful customer-facing Week 1 rankings before any current-season
// regular-season usage/production evidence exists.
//
// Week 1 is fundamentally different from Weeks 2-18:
//
//   Week 1:
//     current market ADP + current player context
//
//   Weeks 2-18:
//     normal Weekly SAGE evidence + scoring pipeline
//
// This function is intentionally NOT Weekly SAGE scoring. It does not try
// to fabricate prior-week evidence, historical usage, production scores,
// confidence calculations, or matchup-defense scores.
//
// The Week 1 baseline is built from the same live ADP source already used
// by Draft Command Center:
//
//   /.netlify/functions/adp
//
// That function currently obtains Tank01 ADP and translates it into:
//
//   {
//     players: [
//       {
//         name,
//         position,
//         team,
//         adp
//       }
//     ],
//     meta: {
//       source,
//       adpType,
//       adpDate
//     }
//   }
//
// OUTPUT
// ------
// Returns the same high-level positional structure expected by
// weekly-sage-rankings / weekly.html:
//
//   {
//     positions: {
//       QB: [...],
//       RB: [...],
//       WR: [...],
//       TE: [...]
//     }
//   }
//
// Individual Week 1 records deliberately include Week-1-specific fields
// such as `adp`, `overallRank`, `positionRank`, `rankingScore`, and
// `baselineEvidenceType`.
//
// `sageScore` is deliberately NULL.
//
// ADP is NOT a projected fantasy-point total and is NOT a SAGE score.
// The frontend should never label the Week 1 ranking value as projected
// fantasy points.
//
// RECOMMENDATION BASELINE
// -----------------------
// To provide useful Week 1 Start/Flex/Sit guidance before regular-season
// evidence exists, recommendations use position rank against a conventional
// league-size baseline.
//
// For N teams:
//
//   QB:
//     START = QB1 through QBN
//     SIT   = remaining QBs
//
//   RB:
//     START = RB1 through RB(2N)
//     FLEX  = next N RBs
//     SIT   = remaining RBs
//
//   WR:
//     START = WR1 through WR(2N)
//     FLEX  = next N WRs
//     SIT   = remaining WRs
//
//   TE:
//     START = TE1 through TEN
//     FLEX  = next ceil(N/2) TEs
//     SIT   = remaining TEs
//
// Default league size is 12.
//
// These are transparent Week 1 baseline recommendations only. They are
// replaced by the normal SAGE recommendation methodology beginning Week 2.
//
// EXAMPLES
// --------
// /.netlify/functions/weekly-sage-week1-rankings?season=2026&week=1
//
// /.netlify/functions/weekly-sage-week1-rankings
//   ?season=2026
//   &week=1
//   &scoring=ppr
//   &teams=12
//
// Supported scoring values:
//   ppr
//   half
//   half-ppr
//   standard
//
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_SEASON_TYPE = "reg";
const DEFAULT_SCORING = "ppr";
const DEFAULT_TEAMS = 12;

const POSITIONS = ["QB", "RB", "WR", "TE"];

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=1800, stale-while-revalidate=3600";

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": CACHE_CONTROL
    },
    body: JSON.stringify(body, null, 2)
  };
}

function getBaseUrl(event) {
  const headers = event.headers || {};

  const proto =
    headers["x-forwarded-proto"] ||
    headers["X-Forwarded-Proto"] ||
    "https";

  const host =
    headers.host ||
    headers.Host;

  if (!host) {
    throw new Error("Could not determine host.");
  }

  return `${proto}://${host}`;
}

function normalizeScoring(scoring) {
  const raw =
    String(scoring || DEFAULT_SCORING)
      .trim()
      .toLowerCase();

  if (raw === "half" || raw === "half-ppr" || raw === "halfppr") {
    return "half-ppr";
  }

  if (raw === "standard") {
    return "standard";
  }

  return "ppr";
}

function normalizeTeams(value) {
  const n = Number(value);

  if (!Number.isInteger(n)) {
    return DEFAULT_TEAMS;
  }

  if (n < 6 || n > 20) {
    return DEFAULT_TEAMS;
  }

  return n;
}

function normalizePosition(position) {
  const raw =
    String(position || "")
      .trim()
      .toUpperCase();

  if (raw === "PK") {
    return "K";
  }

  if (raw === "DST") {
    return "DEF";
  }

  return raw;
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function recommendationForPositionRank({
  position,
  positionRank,
  teams
}) {
  if (!Number.isInteger(positionRank) || positionRank < 1) {
    return null;
  }

  if (position === "QB") {
    return positionRank <= teams
      ? "START"
      : "SIT";
  }

  if (position === "RB" || position === "WR") {
    const starterCutoff =
      teams * 2;

    const flexCutoff =
      starterCutoff + teams;

    if (positionRank <= starterCutoff) {
      return "START";
    }

    if (positionRank <= flexCutoff) {
      return "FLEX";
    }

    return "SIT";
  }

  if (position === "TE") {
    const starterCutoff =
      teams;

    const flexCutoff =
      starterCutoff +
      Math.ceil(teams / 2);

    if (positionRank <= starterCutoff) {
      return "START";
    }

    if (positionRank <= flexCutoff) {
      return "FLEX";
    }

    return "SIT";
  }

  return null;
}

function recommendationLabel({
  recommendation,
  position,
  positionRank,
  teams
}) {
  if (!recommendation) {
    return null;
  }

  if (recommendation === "START") {
    return (
      `Week 1 ${position}${positionRank} baseline · ` +
      `starter range for a ${teams}-team league`
    );
  }

  if (recommendation === "FLEX") {
    return (
      `Week 1 ${position}${positionRank} baseline · ` +
      `flex consideration for a ${teams}-team league`
    );
  }

  return (
    `Week 1 ${position}${positionRank} baseline · ` +
    `outside the primary starter range for a ${teams}-team league`
  );
}

function confidenceLabelForAdp(adp) {
  if (!Number.isFinite(adp)) {
    return null;
  }

  // This is NOT SAGE confidence.
  //
  // The label communicates how established the player's draft-market
  // position currently is, using broad ADP bands only.
  //
  // It exists so the Week 1 UI can provide useful supporting context
  // without pretending current-season evidence exists.

  if (adp <= 36) {
    return "High";
  }

  if (adp <= 96) {
    return "Moderate";
  }

  return "Developing";
}

function rankingScoreFromAdp(adp) {
  if (!Number.isFinite(adp)) {
    return null;
  }

  // Higher is better so consumers can sort descending if desired.
  //
  // This is merely an inverse ADP sorting value.
  // It is NOT:
  // - projected fantasy points
  // - a SAGE score
  // - a probability
  // - a performance forecast
  //
  // Examples:
  //   ADP 1.0   -> 299.0
  //   ADP 25.0  -> 275.0
  //   ADP 100.0 -> 200.0

  return Math.max(
    0,
    Number(
      (300 - adp).toFixed(2)
    )
  );
}

async function fetchAdp({
  baseUrl,
  scoring,
  teams,
  season
}) {
  const params =
    new URLSearchParams({
      scoring,
      teams: String(teams),
      year: String(season),
      count: "300"
    });

  const url =
    `${baseUrl}/.netlify/functions/adp?${params.toString()}`;

  let response;

  try {
    response =
      await fetch(
        url,
        {
          method: "GET",
          headers: {
            Accept: "application/json"
          }
        }
      );
  } catch (error) {
    throw new Error(
      `ADP request failed: ${
        error && error.message
          ? error.message
          : "unknown fetch error"
      }`
    );
  }

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
        data.error ||
        data.detail ||
        data.errors
      );

    throw new Error(
      `ADP endpoint returned ${
        response.status
      }${
        detail
          ? `: ${detail}`
          : ""
      }`
    );
  }

  if (
    !data ||
    !Array.isArray(data.players)
  ) {
    throw new Error(
      "ADP endpoint returned no players array."
    );
  }

  return data;
}

function buildWeek1Positions({
  players,
  teams
}) {
  const positions = {
    QB: [],
    RB: [],
    WR: [],
    TE: []
  };

  const normalized =
    players
      .map(function (player) {
        const position =
          normalizePosition(
            player.position
          );

        if (
          !POSITIONS.includes(position)
        ) {
          return null;
        }

        const adp =
          finiteNumber(player.adp);

        if (
          !player.name ||
          adp === null
        ) {
          return null;
        }

        return {
          name:
            String(player.name).trim(),

          position,

          team:
            player.team
              ? String(player.team)
              : null,

          adp
        };
      })
      .filter(Boolean);

  normalized.sort(function (a, b) {
    if (a.adp !== b.adp) {
      return a.adp - b.adp;
    }

    return a.name.localeCompare(b.name);
  });

  const overallRankByKey =
    new Map();

  normalized.forEach(
    function (player, index) {
      const key =
        `${player.position}|${player.name}`;

      overallRankByKey.set(
        key,
        index + 1
      );
    }
  );

  POSITIONS.forEach(function (position) {
    const positionPlayers =
      normalized
        .filter(function (player) {
          return player.position === position;
        })
        .sort(function (a, b) {
          if (a.adp !== b.adp) {
            return a.adp - b.adp;
          }

          return a.name.localeCompare(
            b.name
          );
        });

    positions[position] =
      positionPlayers.map(
        function (player, index) {
          const positionRank =
            index + 1;

          const overallRank =
            overallRankByKey.get(
              `${player.position}|${player.name}`
            ) || null;

          const recommendation =
            recommendationForPositionRank({
              position,
              positionRank,
              teams
            });

          const rankingScore =
            rankingScoreFromAdp(
              player.adp
            );

          const confidenceLabel =
            confidenceLabelForAdp(
              player.adp
            );

          return {
            name:
              player.name,

            position:
              player.position,

            team:
              player.team,

            opponent:
              null,

            recommendation,

            adp:
              player.adp,

            overallRank,

            positionRank,

            rankingScore,

            // Deliberately null.
            //
            // ADP / rankingScore must never masquerade as Weekly SAGE
            // or projected fantasy points.
            sageScore:
              null,

            sageLabel:
              recommendationLabel({
                recommendation,
                position,
                positionRank,
                teams
              }),

            sageConfidence:
              null,

            sageConfidenceLabel:
              confidenceLabel,

            baselineEvidenceType:
              "week1-adp-baseline"
          };
        }
      );
  });

  return positions;
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

    const targetWeek =
      query.week == null ||
      query.week === ""
        ? 1
        : Number(query.week);

    const seasonType =
      String(
        query.seasonType ||
        DEFAULT_SEASON_TYPE
      );

    const scoring =
      normalizeScoring(
        query.scoring
      );

    const teams =
      normalizeTeams(
        query.teams
      );

    if (
      !Number.isInteger(targetWeek) ||
      targetWeek !== 1
    ) {
      return jsonResponse(
        400,
        {
          error:
            "weekly-sage-week1-rankings only serves Week 1.",
          targetWeek
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

    let baseUrl;

    try {
      baseUrl =
        getBaseUrl(event);
    } catch (error) {
      return jsonResponse(
        500,
        {
          error:
            error.message
        }
      );
    }

    let adpData;

    try {
      adpData =
        await fetchAdp({
          baseUrl,
          scoring,
          teams,
          season
        });
    } catch (error) {
      return jsonResponse(
        502,
        {
          evidenceType:
            "weekly-sage-week1-rankings",

          schemaVersion:
            1,

          generatedAt:
            new Date().toISOString(),

          season,

          targetWeek,

          seasonType,

          scoring,

          teams,

          error:
            "Week 1 ADP baseline could not be produced.",

          detail:
            error &&
            error.message
              ? error.message
              : String(error)
        }
      );
    }

    const positions =
      buildWeek1Positions({
        players:
          adpData.players,
        teams
      });

    const counts = {};

    POSITIONS.forEach(
      function (position) {
        counts[position] =
          positions[position].length;
      }
    );

    const totalPlayers =
      POSITIONS.reduce(
        function (sum, position) {
          return (
            sum +
            positions[position].length
          );
        },
        0
      );

    if (totalPlayers === 0) {
      return jsonResponse(
        502,
        {
          evidenceType:
            "weekly-sage-week1-rankings",

          schemaVersion:
            1,

          generatedAt:
            new Date().toISOString(),

          season,

          targetWeek,

          seasonType,

          scoring,

          teams,

          error:
            "Week 1 ADP baseline contained no QB/RB/WR/TE players.",

          positions,

          counts
        }
      );
    }

    return jsonResponse(
      200,
      {
        evidenceType:
          "weekly-sage-week1-rankings",

        schemaVersion:
          1,

        generatedAt:
          new Date().toISOString(),

        season,

        targetWeek,

        seasonType,

        scoring,

        teams,

        positions,

        failures: {
          QB: [],
          RB: [],
          WR: [],
          TE: []
        },

        metadata: {
          baselineEvidenceType:
            "week1-adp-baseline",

          methodology:
            "Current market ADP baseline. No current-season regular-season usage or production evidence exists before Week 1.",

          adpSource:
            adpData.meta &&
            adpData.meta.source
              ? adpData.meta.source
              : null,

          adpType:
            adpData.meta &&
            adpData.meta.adpType
              ? adpData.meta.adpType
              : null,

          adpDate:
            adpData.meta &&
            adpData.meta.adpDate
              ? adpData.meta.adpDate
              : null,

          scoring,

          leagueSizeBaseline:
            teams,

          counts,

          totalPlayers,

          recommendationBasis: {
            QB:
              `START through QB${teams}; remaining QBs SIT.`,

            RB:
              `START through RB${teams * 2}; FLEX through RB${teams * 3}; remaining RBs SIT.`,

            WR:
              `START through WR${teams * 2}; FLEX through WR${teams * 3}; remaining WRs SIT.`,

            TE:
              `START through TE${teams}; FLEX through TE${
                teams +
                Math.ceil(teams / 2)
              }; remaining TEs SIT.`
          },

          sageScoringApplied:
            false,

          priorWeekEvidenceRequired:
            false,

          note:
            "Week 1 uses a transparent ADP-based baseline because no current-season regular-season evidence exists yet. Normal Weekly SAGE scoring begins with Week 2."
        }
      }
    );
  };
