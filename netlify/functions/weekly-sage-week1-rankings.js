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
// WEEK 1 MATCHUP ENRICHMENT (display/context only)
// -------------------------------------------------
// 2026 Week 1 has no prior-week defensive evidence of its own, so the
// normal current-season matchup-defense path cannot produce a
// meaningful signal here. As a Week-1-only exception, this function
// reuses the already-existing 2025 Weeks 1-7 defensive matchup
// baseline (weekly-sage-matchup-defense.js's own unmodified
// buildMatchupDefense(), called with season "2025", week 8) as
// preseason context, paired with each player's REAL, already-resolved
// 2026 Week 1 opponent.
//
// This does NOT calculate a new score, invent a new methodology, or
// touch weekly-sage-matchup-defense.js in any way -- it reads that
// function's existing run / pass / receiving fields verbatim:
//
//   RB -> run
//   QB -> pass
//   WR -> receiving
//   TE -> receiving
//
// The result is exposed as matchupStrength / matchupEvidence and is
// explicitly marked matchupEvidenceType: "2025-week8-defense-baseline"
// so it is never mistaken for current-season SAGE evidence. It has no
// effect on rank, ADP order, rankingScore, recommendation, or
// sageScore, and failure to load it is non-fatal -- Team/Opponent and
// the rest of the response are unaffected either way.
//
// ═══════════════════════════════════════════════════════════════════════

const {
  connectLambda,
  getStore
} = require(
  "@netlify/blobs"
);

const {
  buildMatchupDefense
} = require(
  "./weekly-sage-matchup-defense.js"
);

const {
  buildWeek1SageTake
} = require(
  "./sage-take.js"
);

const DEFAULT_SEASON_TYPE = "reg";

const PLAYER_DATA_STORE =
  "player-data";

const PLAYER_DATA_KEY =
  "playerData";

const SCHEDULE_STORE =
  "weekly-sage-schedule";
const DEFAULT_SCORING = "ppr";
const DEFAULT_TEAMS = 12;

const POSITIONS = ["QB", "RB", "WR", "TE", "K"];

/*
  WEEK 1 MATCHUP BASELINE (display/context only)
  -----------------------------------------------
  Fixed, explicit source for the Week 1 matchup exception described
  above. This is intentionally NOT derived from the requested season/
  week -- Week 1 always uses this exact 2025 baseline, regardless of
  which season is requested, because no current-season defensive
  evidence can exist yet for a Week 1 request.
*/
const MATCHUP_BASELINE_SEASON =
  "2025";

const MATCHUP_BASELINE_WEEK =
  8;

const MATCHUP_BASELINE_SEASON_TYPE =
  "reg";

const MATCHUP_EVIDENCE_TYPE =
  "2025-week8-defense-baseline";

/*
  Maps each fantasy position to the existing matchup-defense field
  that already represents its relevant defensive signal. No new
  calculation -- these fields already exist on every
  buildMatchupDefense() team entry.
*/
const MATCHUP_FIELD_BY_POSITION = {
  RB: "run",
  QB: "pass",
  WR: "receiving",
  TE: "receiving"
};

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

function normalizeTeam(value) {
  const raw =
    String(value || "")
      .trim()
      .toUpperCase();

  const aliases = {
    JAC: "JAX",
    GBP: "GB",
    KAN: "KC",
    LVR: "LV",
    NEP: "NE",
    NOR: "NO",
    SFO: "SF",
    TBB: "TB",
    WAS: "WSH"
  };

  return aliases[raw] || raw;
}

function normalizePlayerName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function buildPlayerTeamMap(playerDataCache) {
  const map = new Map();

  const players =
    playerDataCache &&
    playerDataCache.players &&
    typeof playerDataCache.players === "object"
      ? playerDataCache.players
      : {};

  Object.values(players).forEach(function (player) {
    if (!player || !player.longName || !player.team) {
      return;
    }

    const key = normalizePlayerName(player.longName);
    const team = normalizeTeam(player.team);

    if (key && team) {
      map.set(key, team);
    }
  });

  return map;
}

function buildOpponentMap(schedule) {
  const map = new Map();

  const games =
    schedule && Array.isArray(schedule.games)
      ? schedule.games
      : [];

  games.forEach(function (game) {
    const away = normalizeTeam(game && game.away);
    const home = normalizeTeam(game && game.home);

    if (away && home) {
      map.set(away, home);
      map.set(home, away);
    }
  });

  const byeTeams =
    schedule && Array.isArray(schedule.byeTeams)
      ? schedule.byeTeams
      : [];

  byeTeams.forEach(function (team) {
    const normalized = normalizeTeam(team);

    if (normalized) {
      map.set(normalized, "BYE");
    }
  });

  return map;
}

/*
  Look up the existing, unmodified matchup-defense signal for one
  player's opponent, by position. Returns null whenever the baseline
  is unavailable, the opponent is unknown/BYE, or the position has no
  mapped field -- never fabricates a value.

  This does not calculate anything new. It reads run / pass /
  receiving verbatim from buildMatchupDefense()'s own output.
*/
function matchupForPlayer({
  position,
  opponent,
  matchupBaseline
}) {
  if (
    !matchupBaseline ||
    !opponent ||
    opponent === "BYE"
  ) {
    return null;
  }

  const fieldName =
    MATCHUP_FIELD_BY_POSITION[position];

  if (!fieldName) {
    return null;
  }

  const opponentEntry =
    matchupBaseline[
      normalizeTeam(opponent)
    ];

  if (!opponentEntry) {
    return null;
  }

  const signal =
    opponentEntry[fieldName];

  if (!signal) {
    return null;
  }

  return {
    matchupStrength:
      signal.label || null,

    matchupEvidence: {
      score:
        typeof signal.score === "number"
          ? signal.score
          : null,

      signal:
        signal.signal || null,

      label:
        signal.label || null
    },

    matchupEvidenceType:
      MATCHUP_EVIDENCE_TYPE
  };
}

async function readWeek1Evidence({
  season,
  week,
  seasonType
}) {
  const playerStore =
    getStore({
      name: PLAYER_DATA_STORE
    });

  const scheduleStore =
    getStore({
      name: SCHEDULE_STORE
    });

  const scheduleKey =
    `week:${season}:${week}:${seasonType}`;

  const [playerDataCache, schedule] =
    await Promise.all([
      playerStore.get(
        PLAYER_DATA_KEY,
        { type: "json" }
      ),
      scheduleStore.get(
        scheduleKey,
        { type: "json" }
      )
    ]);

  return {
    playerDataCache,
    schedule,
    scheduleKey
  };
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

  // Kickers are conventionally a single-starter position in the vast
  // majority of leagues, the same shape as QB -- reusing QB's exact
  // existing single-starter rule rather than inventing a new
  // recommendation concept. This is Week 1 baseline tiering only,
  // driven by preseason value/ADP-derived positionRank; it is not a
  // kicker scoring formula and does not use any kicking evidence.
  if (position === "K") {
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
  teams,
  playerTeamMap,
  opponentMap,
  matchupBaseline
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
            normalizeTeam(
              player.team ||
              playerTeamMap.get(
                normalizePlayerName(
                  player.name
                )
              )
            ) || null,

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

          const opponent =
            player.team
              ? (
                  opponentMap.get(
                    normalizeTeam(
                      player.team
                    )
                  ) || null
                )
              : null;

          const matchup =
            matchupForPlayer({
              position:
                player.position,

              opponent,

              matchupBaseline
            });

          return {
            name:
              player.name,

            position:
              player.position,

            team:
              player.team,

            opponent,

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

            // Display/context only -- see WEEK 1 MATCHUP ENRICHMENT
            // above. Never current-season SAGE; null whenever the
            // 2025 baseline or opponent is unavailable.
            matchupStrength:
              matchup
                ? matchup.matchupStrength
                : null,

            matchupEvidence:
              matchup
                ? matchup.matchupEvidence
                : null,

            matchupEvidenceType:
              matchup
                ? matchup.matchupEvidenceType
                : null,

            // Deterministic explanation layer -- see sage-take.js.
            // Read-only against the fields above; never influences
            // recommendation, rankingScore, or sort order. null on
            // any failure or lack of usable evidence, in which case
            // weekly.html falls back to its existing baseline text.
            sageTake:
              buildWeek1SageTake({
                recommendation,

                positionRank,

                matchupStrength:
                  matchup
                    ? matchup.matchupStrength
                    : null
              }),

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

    let week1Evidence = {
      playerDataCache: null,
      schedule: null,
      scheduleKey:
        `week:${season}:${targetWeek}:${seasonType}`
    };

    const evidenceWarnings = [];

    try {
      connectLambda(
        event
      );

      week1Evidence =
        await readWeek1Evidence({
          season,
          week: targetWeek,
          seasonType
        });
    } catch (error) {
      evidenceWarnings.push(
        `Optional Week 1 Team/Opponent evidence could not be read: ${
          error && error.message
            ? error.message
            : String(error)
        }`
      );
    }

    if (
      !week1Evidence.playerDataCache ||
      !week1Evidence.playerDataCache.players
    ) {
      evidenceWarnings.push(
        "Optional player-data cache is unavailable; Team will use ADP data when available."
      );
    }

    if (
      !week1Evidence.schedule ||
      !Array.isArray(
        week1Evidence.schedule.games
      )
    ) {
      evidenceWarnings.push(
        "Optional Week 1 shared schedule cache is unavailable; Opponent will remain null."
      );
    }

    /*
      WEEK 1 MATCHUP BASELINE (display/context only)
      -----------------------------------------------
      Reuses the existing, unmodified buildMatchupDefense() builder
      with the fixed 2025 Week 8 baseline described above. This is
      strictly additive context -- failure here is non-fatal and
      never causes a 502; Team/Opponent and the rest of the response
      are produced exactly as before regardless of outcome.
    */
    let matchupBaseline = null;

    let matchupBaselineLoaded = false;

    try {
      const matchupDefenseResult =
        await buildMatchupDefense({
          baseUrl,
          season: MATCHUP_BASELINE_SEASON,
          week: MATCHUP_BASELINE_WEEK,
          seasonType: MATCHUP_BASELINE_SEASON_TYPE
        });

      if (
        matchupDefenseResult &&
        matchupDefenseResult.matchups &&
        typeof matchupDefenseResult.matchups === "object"
      ) {
        matchupBaseline =
          matchupDefenseResult.matchups;

        matchupBaselineLoaded = true;
      } else {
        evidenceWarnings.push(
          "Optional Week 1 matchup baseline returned no usable matchup data; Matchup will remain null."
        );
      }
    } catch (error) {
      evidenceWarnings.push(
        `Optional Week 1 matchup baseline could not be loaded: ${
          error && error.message
            ? error.message
            : String(error)
        }`
      );
    }

    const playerTeamMap =
      buildPlayerTeamMap(
        week1Evidence.playerDataCache
      );

    const opponentMap =
      buildOpponentMap(
        week1Evidence.schedule
      );

    const positions =
      buildWeek1Positions({
        players:
          adpData.players,
        teams,
        playerTeamMap,
        opponentMap,
        matchupBaseline
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
              }; remaining TEs SIT.`,

            K:
              `START through K${teams}; remaining Ks SIT.`
          },

          playerTeamEvidence:
            week1Evidence.playerDataCache &&
            week1Evidence.playerDataCache.players
              ? "player-data-blob"
              : "adp-fallback",

          scheduleEvidence:
            week1Evidence.schedule &&
            Array.isArray(
              week1Evidence.schedule.games
            )
              ? "weekly-sage-schedule-blob"
              : null,

          scheduleBlobKey:
            week1Evidence.scheduleKey,

          // Display/context only -- see WEEK 1 MATCHUP ENRICHMENT
          // above. Does not indicate SAGE evidence of any kind.
          matchupBaselineEvidence:
            matchupBaselineLoaded
              ? MATCHUP_EVIDENCE_TYPE
              : null,

          matchupBaselineLoaded,

          evidenceWarnings,

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
