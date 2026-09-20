// netlify/functions/weekly-sage-k-leaderboard.js
//
// WEEKLY SAGE — K (PLACE KICKER) LEADERBOARD
//
// PURPOSE
// -------
// Build the customer-facing Weekly SAGE K leaderboard for one target
// week, entirely from already-cached evidence.
//
// SOURCES (both cache-only, both fail-fast on a miss)
// ----------------------------------------------------
//   k-snapshot               (weekly-sage-k-snapshot.js's own output,
//                              written by refresh-k-snapshot.js)
//   weekly-sage-schedule     (for this week's opponent per team)
//
// This function makes ZERO direct Tank01 calls, and does NOT call
// weekly-sage-k-snapshot.js's builder itself -- if the cache is
// missing, this fails fast (503) rather than rebuilding live. That
// rebuild remains available only via refresh-k-snapshot.js's own
// manual/future-scheduled path -- never from a customer request.
//
// This function does NOT recalculate any K score, and does NOT use
// the QB/RB/WR/TE role/production/matchup recommendation model --
// K's own SAGE Take is built locally in this file from the K-specific
// evidence already present on each snapshot record.
//
// ═══════════════════════════════════════════════════════════════════════

const {
  connectLambda,
  getStore
} = require(
  "@netlify/blobs"
);

const DEFAULT_SEASON_TYPE =
  "reg";

const K_SNAPSHOT_STORE =
  "k-snapshot";

const DEF_SNAPSHOT_STORE =
  "def-snapshot";

const SCHEDULE_STORE =
  "weekly-sage-schedule";

const ADP_SNAPSHOT_STORE =
  "adp-snapshot";

// A single kicking line is far too volatile to erase the established
// expectation. The baseline deliberately fades as current-season games
// accumulate, matching the early-season treatment used at QB/RB/WR/TE.
const EARLY_SEASON_BASELINE_WEIGHT = Object.freeze({
  2: 0.90,
  3: 0.65,
  4: 0.40
});

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

const DEFAULT_TEAMS =
  12;

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

function normalizeName(value) {
  return String(value || "").trim().toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function matchupSignal(score) {
  if (score >= 80) return { signal: "strong_positive", label: "Strong Positive" };
  if (score >= 60) return { signal: "positive", label: "Positive" };
  if (score > 40) return { signal: "neutral", label: "Neutral" };
  if (score > 20) return { signal: "negative", label: "Negative" };
  return { signal: "strong_negative", label: "Strong Negative" };
}

function buildKMatchupEvidence(opponent, defenseSnapshot) {
  if (!opponent || opponent === "BYE" || !defenseSnapshot || !Array.isArray(defenseSnapshot.population)) {
    return null;
  }
  const defense = defenseSnapshot.population.find(function (row) {
    return normalizeTeam(row && row.team) === normalizeTeam(opponent);
  });
  const prevention = Number(defense && defense.components && defense.components.scoringPrevention && defense.components.scoringPrevention.percentile);
  if (!Number.isFinite(prevention)) return null;
  const score = Math.max(0, Math.min(100, 100 - prevention));
  return {
    score,
    ...matchupSignal(score),
    source: "opponent-scoring-prevention"
  };
}

async function readDefSnapshotForMatchup({ season, targetWeek, seasonType }) {
  try {
    const cached = await getStore({ name: DEF_SNAPSHOT_STORE })
      .get(`week:${season}:${targetWeek}:${seasonType}`, { type: "json" });
    return cached && cached.evidenceType === "weekly-sage-def-snapshot" ? cached : null;
  } catch (error) {
    return null;
  }
}

async function readAdpBaseline(scoring) {
  const raw = String(scoring || "ppr").trim().toLowerCase();
  const normalized = ["half-ppr", "half_ppr", "0.5-ppr", "0.5_ppr", "hppr"]
    .includes(raw) ? "half" : (raw === "standard" || raw === "non-ppr" ? "standard" : "ppr");
  try {
    const cached = await getStore({ name: ADP_SNAPSHOT_STORE })
      .get(`scoring:${normalized}`, { type: "json" });
    return cached && cached.evidenceType === "tank01-adp-snapshot" &&
      Array.isArray(cached.players) ? cached : null;
  } catch (error) {
    return null;
  }
}

function applyEarlySeasonBaseline({ population, adpSnapshot, week }) {
  const weight = EARLY_SEASON_BASELINE_WEIGHT[Number(week)] || 0;
  if (!weight || !adpSnapshot || !Array.isArray(adpSnapshot.players)) {
    return { applied: false, matched: 0, baselineWeight: 0 };
  }

  const eligible = new Set(population.map(row => normalizeName(row.name)).filter(Boolean));
  const baselinePlayers = adpSnapshot.players
    .filter(player => String(player && player.position || "").toUpperCase() === "K" &&
      Number.isFinite(Number(player && player.adp)) &&
      eligible.has(normalizeName(player.name || player.longName || player.playerName)))
    .sort((a, b) => Number(a.adp) - Number(b.adp));
  const byId = new Map();
  const byName = new Map();
  baselinePlayers.forEach((player, index) => {
    const baseline = { positionRank: index + 1, adp: Number(player.adp) };
    const id = String(player.playerID ?? player.playerId ?? player.id ?? "").trim();
    if (id) byId.set(id, baseline);
    const name = normalizeName(player.name || player.longName || player.playerName);
    if (name) byName.set(name, baseline);
  });

  const current = population.slice().sort((a, b) => Number(b.sageScore || 0) - Number(a.sageScore || 0));
  let matched = 0;
  current.forEach((row, index) => {
    const evidenceRank = index + 1;
    const baseline = byId.get(String(row.playerID || "")) || byName.get(normalizeName(row.name));
    if (!baseline) {
      // Missing identity/baseline evidence must fail conservatively. Otherwise
      // an unmatched kicker can bypass the guardrail and retain an inflated
      // one-game rank while every matched kicker is stabilized.
      const fallbackRank = baselinePlayers.length + 1;
      const expectedRank = fallbackRank * weight + evidenceRank * (1 - weight);
      row.rankingScore = 100 - expectedRank;
      row.baseline = {
        applied: false,
        reason: "No matching K baseline; conservative fallback applied.",
        weight,
        currentEvidenceRank: evidenceRank,
        fallbackRank,
        expectedRank: Math.round(expectedRank * 1000) / 1000
      };
      return;
    }
    matched += 1;
    const expectedRank = baseline.positionRank * weight + evidenceRank * (1 - weight);
    row.rankingScore = 100 - expectedRank;
    row.baseline = {
      applied: true,
      weight,
      adp: baseline.adp,
      positionRank: baseline.positionRank,
      currentEvidenceRank: evidenceRank,
      expectedRank: Math.round(expectedRank * 1000) / 1000
    };
  });
  return { applied: matched > 0, matched, baselineWeight: weight };
}

async function readKSnapshot({
  season,
  targetWeek,
  seasonType
}) {
  const key =
    `week:${season}:${targetWeek}:${seasonType}`;

  let cached =
    null;

  try {
    const store =
      getStore({
        name:
          K_SNAPSHOT_STORE
      });

    cached =
      await store.get(
        key,
        {
          type: "json"
        }
      );
  } catch (error) {
    const err =
      new Error(
        "K snapshot cache could not be read."
      );

    err.statusCode = 503;
    err.detail = error && error.message;
    throw err;
  }

  if (
    !cached ||
    cached.evidenceType !==
      "weekly-sage-k-snapshot"
  ) {
    const err =
      new Error(
        `No cached K snapshot found for ${key}. Run refresh-k-snapshot first.`
      );

    err.statusCode = 503;
    throw err;
  }

  return cached;
}

async function readSchedule({
  season,
  targetWeek,
  seasonType
}) {
  const key =
    `week:${season}:${targetWeek}:${seasonType}`;

  let cached =
    null;

  try {
    const store =
      getStore({
        name:
          SCHEDULE_STORE
      });

    cached =
      await store.get(
        key,
        {
          type: "json"
        }
      );
  } catch (error) {
    const err =
      new Error(
        "Weekly SAGE schedule cache could not be read."
      );

    err.statusCode = 503;
    err.detail = error && error.message;
    throw err;
  }

  if (
    !cached ||
    cached.evidenceType !==
      "weekly-sage-schedule"
  ) {
    const err =
      new Error(
        `No cached Weekly SAGE schedule found for ${key}. Run refresh-weekly-sage-schedule first.`
      );

    err.statusCode = 503;
    throw err;
  }

  return cached;
}

function buildOpponentMap(schedule) {
  const map =
    new Map();

  const games =
    Array.isArray(
      schedule.games
    )
      ? schedule.games
      : [];

  games.forEach(function (game) {
    const away =
      normalizeTeam(
        game.away
      );

    const home =
      normalizeTeam(
        game.home
      );

    if (away && home) {
      map.set(away, home);
      map.set(home, away);
    }
  });

  const byeTeams =
    Array.isArray(
      schedule.byeTeams
    )
      ? schedule.byeTeams
      : [];

  byeTeams.forEach(function (team) {
    const normalized =
      normalizeTeam(team);

    if (normalized) {
      map.set(normalized, "BYE");
    }
  });

  return map;
}

/*
  K-specific deterministic SAGE Take -- built locally from the same
  component evidence already on each snapshot record. Never routes
  through QB/RB/WR/TE's role/production/matchup take logic. No
  network/AI call; a pure, local lookup against already-computed
  percentiles.
*/
function buildKSageTake(record) {
  try {
    const components =
      record.components ||
      {};

    const signals =
      [
        { key: "opportunity", pct: components.opportunity && components.opportunity.percentile },
        { key: "teamScoring", pct: components.teamScoring && components.teamScoring.percentile },
        { key: "reliability", pct: components.reliability && components.reliability.percentile }
      ].filter(function (s) {
        return typeof s.pct === "number";
      });

    if (!signals.length) {
      return null;
    }

    signals.sort(function (a, b) {
      return Math.abs(b.pct - 50) - Math.abs(a.pct - 50);
    });

    const primary =
      signals[0];

    const phraseFor = {
      opportunity: {
        high: "Strong scoring opportunity",
        low: "Limited field-goal chances"
      },
      teamScoring: {
        high: "Plays for a high-scoring offense",
        low: "Plays for a low-scoring offense"
      },
      reliability: {
        high: "Reliable recent accuracy",
        low: "Inconsistent recent accuracy"
      }
    };

    const direction =
      primary.pct >= 50
        ? "high"
        : "low";

    const lead =
      phraseFor[primary.key][direction];

    const rangeBonus =
      components.range &&
      typeof components.range.percentile ===
        "number" &&
      components.range.percentile >= 70;

    const rangeClause =
      rangeBonus
        ? " Long-range upside adds extra value."
        : "";

    const confidenceClause =
      record.sageConfidenceLabel &&
      record.sageConfidenceLabel !== "Full" &&
      record.sageConfidenceLabel !== "High"
        ? " Still a small sample this season."
        : "";

    return (
      lead +
      "." +
      rangeClause +
      confidenceClause
    );
  } catch (error) {
    return null;
  }
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
      )
        .trim()
        .toLowerCase();

    const teams =
      Number(
        query.teams
      ) ||
      DEFAULT_TEAMS;

    if (
      !Number.isInteger(
        targetWeek
      ) ||
      targetWeek < 2 ||
      targetWeek > 18
    ) {
      return jsonResponse(
        400,
        {
          error:
            "week must be an integer from 2 through 18."
        }
      );
    }

    try {
      const [
        snapshot,
        schedule,
        adpSnapshot,
        defenseSnapshot
      ] =
        await Promise.all([
          readKSnapshot({
            season,
            targetWeek,
            seasonType
          }),

          readSchedule({
            season,
            targetWeek,
            seasonType
          }),

          readAdpBaseline(query.scoring),

          readDefSnapshotForMatchup({
            season,
            targetWeek,
            seasonType
          })
        ]);

      const opponentMap =
        buildOpponentMap(
          schedule
        );

      const population = snapshot.population.slice();
      const baselineApplication = applyEarlySeasonBaseline({
        population,
        adpSnapshot,
        week: targetWeek
      });

      const sorted =
        population
          .sort(function (a, b) {
            return (
              (b.rankingScore ?? b.sageScore ?? 0) -
              (a.rankingScore ?? a.sageScore ?? 0)
            );
          });

      const leaderboard =
        sorted.map(function (
          record,
          index
        ) {
          const positionRank =
            index + 1;

          const opponent =
            opponentMap.get(
              normalizeTeam(
                record.team
              )
            ) || null;

          const recommendation =
            opponent === "BYE"
              ? null
              : (positionRank <= teams
                  ? "START"
                  : "SIT");

          const matchupEvidence =
            buildKMatchupEvidence(opponent, defenseSnapshot);

          return {
            playerID:
              record.playerID,

            name:
              record.name,

            team:
              record.team,

            position:
              "K",

            opponent:
              opponent,

            matchup:
              matchupEvidence,

            matchupStrength:
              matchupEvidence ? matchupEvidence.label : null,

            matchupEvidence:
              matchupEvidence,

            rank:
              positionRank,

            sage: {
              score:
                record.sageScore,

              confidenceLabel:
                record.sageConfidenceLabel
            },

            baseline:
              record.baseline || null,

            recommendation:
              recommendation,

            fgAttempts:
              record.fgAttempts,

            fgMade:
              record.fgMade,

            xpAttempts:
              record.xpAttempts,

            xpMade:
              record.xpMade,

            fgLong:
              record.fgLong,

            components:
              record.components,

            sageTake:
              buildKSageTake(
                record
              )
          };
        });

      return jsonResponse(
        200,
        {
          evidenceType:
            "weekly-sage-k-leaderboard",

          schemaVersion:
            1,

          generatedAt:
            new Date()
              .toISOString(),

          season,

          targetWeek,

          seasonType,

          position:
            "K",

          methodology: {
            modelVersion:
              "k-sage-v1",

            philosophy:
              "Opportunity 40% / Team scoring environment 25% / Reliability 20% / Range 15%. K-specific -- does not use QB/RB/WR/TE role/production/matchup methodology.",

            ranking:
              "Descending Weekly SAGE K ranking score; Weeks 2-4 blend a fading scoring-specific ADP baseline so one early game cannot erase established expectation.",

            earlySeasonBaseline:
              baselineApplication,

            recommendationThresholds: {
              starterCount:
                teams,

              definitions: {
                START:
                  `Weekly SAGE K rank 1 through ${teams}`,

                SIT:
                  `Weekly SAGE K rank ${teams + 1} and beyond`
              }
            }
          },

          architecture: {
            populationSource:
              K_SNAPSHOT_STORE,

            scheduleSource:
              SCHEDULE_STORE,

            populationRebuiltByLeaderboard:
              false,

            directTank01Calls:
              0
          },

          leaderboard,

          nextStep: {
            ready:
              leaderboard.length >
              0,

            reason:
              leaderboard.length >
              0
                ? "K leaderboard built successfully from cached evidence."
                : "No K candidates found in the cached snapshot for this week."
          }
        },

        CACHE_CONTROL
      );
    } catch (error) {
      if (
        typeof (
          error &&
          error.statusCode
        ) ===
        "number"
      ) {
        return jsonResponse(
          error.statusCode,
          {
            error:
              error.message,

            detail:
              error.detail ||
              null
          }
        );
      }

      console.error(
        "weekly-sage-k-leaderboard failed:",
        error
      );

      return jsonResponse(
        502,
        {
          error:
            "Could not build Weekly SAGE K leaderboard.",

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

exports.applyEarlySeasonBaseline = applyEarlySeasonBaseline;
exports.buildKMatchupEvidence = buildKMatchupEvidence;
