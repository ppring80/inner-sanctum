// netlify/functions/refresh-opportunity-intel.js
//
// OPPORTUNITY INTELLIGENCE — Phase 1 (Aug 15 2026) — collection/cache
// ONLY. NOTHING reads its output cache except the companion read-only
// diagnostic endpoint (opportunity-intel.js) built alongside it, and
// (as of the SAGE release-readiness workstream) the SAGE synthesis
// validation endpoints. Draft Command Center, auction recommendations,
// player-comparison.js, Sanctum/chat, and Weekly Rankings are
// completely untouched by this file's existence — confirmed by grep:
// no other file in this repo references the "opportunity-intel" Blobs
// store name introduced here.
//
// MODEL: this file follows the exact architecture already proven
// twice in this codebase — refresh-player-data.js (scheduled fetch +
// Blobs cache + separate read-only file) and refresh-risers-fallers.js
// (getNFLGamesForWeek -> getNFLBoxScore per game, Promise.allSettled,
// cross-reference position from the "player-data" cache rather than
// guessing). Nothing new architecturally; this is that same shape
// applied to a new fact (workload) instead of target share.
//
// WORKLOAD DEFINITION (per Aug 15 2026 Opportunity Intelligence audit):
//   opportunities = Rushing.carries + Receiving.targets
// RB/WR/TE only in Phase 1 — QB workload deliberately not designed yet.
//
// MISSING-DATA SEMANTICS (the one genuinely new piece of logic here,
// everything else is reused pattern):
//   - A player HAS a real box-score entry for a game (they were on the
//     field, playerStats has their line) but that entry's Rushing
//     and/or Receiving sub-object, or the specific carries/targets
//     field inside it, is absent -> normalize that specific missing
//     field to 0. This is a real, valid "0 opportunities that game"
//     data point (e.g. a pass-catching TE who ran zero pass routes
//     that specific week still has a real, valid game record).
//   - A player has NO box-score entry at all for a given game (bye
//     week, inactive, not on the roster that week, the fetch for that
//     game failed) -> that game is EXCLUDED entirely: not a zero, not
//     counted in gamesSampled, not part of any average. A missing
//     record must never silently become a zero-opportunity game.
//
// DESIGN DECISIONS NOT EXPLICITLY SPECIFIED, MADE HERE, FLAGGED FOR
// REVIEW (see report): avgLast3/avgLast5 each independently require
// that many VALID games to exist before returning a number -- both are
// null with fewer than the corresponding count, exactly mirroring the
// explicit trend rule ("null until 6 valid games exist"), rather than
// silently averaging over fewer games than the field name implies.
// gamesSampled reports the TOTAL count of valid games found for that
// player across the whole fetched window (not capped at 5) -- the most
// literal, useful diagnostic signal of "how much real data did we
// actually find," independent of which specific averages that data
// was enough to fill in.
//
// ═══════════════════════════════════════════════════════════════════
// PHASE 2 — SCHEDULED/MANUAL SPLIT (Aug 17 2026 refresh-hardening pass)
// ═══════════════════════════════════════════════════════════════════
//
// This function now supports two completely separate modes, dispatched
// on whether the request carries an explicit `weeks` and/or `season`
// query param:
//
//   MANUAL MODE (params.weeks and/or params.season present):
//     Byte-identical to the original Phase 1 behavior below -- fetch
//     exactly the specified weeks, rebuild the returned players' full
//     records from exactly that explicit game set, overwrite `latest`
//     unconditionally. This is the same tool that produced the real
//     437-player validation dataset; it must keep working exactly as
//     it always has for manual backfill/debugging use.
//
//   SCHEDULED MODE (no params at all -- the shape a Netlify Scheduled
//   Function invokes with):
//     - Derives season and target week dynamically (see
//       deriveCurrentSeason/deriveMaxCachedWeek below) instead of the
//       old hardcoded season:"2026"/weeks:[1,2,3] defaults, which were
//       a real, live bug for exactly this reason -- fine for a manual
//       diagnostic call, unsafe as a permanent default.
//     - Regular season only, capped at week 18. Never chases into
//       preseason or postseason automatically (see the separate
//       preseason/postseason findings report -- automation never
//       constructs a request outside the numeric 1-18 range, so it
//       never needs to know Tank01's conventions for anything else).
//     - Fetches ONLY the single next unfetched week, and MERGES those
//       new per-player games into the existing same-season cache
//       (keyed by gameID, never losing an already-cached game) rather
//       than re-fetching the whole season every run. Every player's
//       final record is still computed by the exact same, completely
//       unmodified buildOpportunityIntelligence() below -- merging
//       only changes what game list gets handed to it.
//     - Refuses to write if this run's Tank01 processing was
//       incomplete for the target week (any box-score fetch failure
//       or normalization failure at all -- deliberately no percentage
//       threshold, see report) or if the merge would somehow have
//       dropped a previously-cached game.
//     - On a season rollover (cached latest.season != derived season),
//       starts fresh at week 1 WITHOUT comparing size/health against
//       the prior season's cache (a new season's week 1 will always
//       look "smaller" than a full prior season -- that's expected,
//       not a failure, and must never block the write). The completed
//       prior season's `latest` snapshot is preserved under its own
//       explicit `season:<year>:final` key before being replaced, in
//       addition to the per-week `window:<season>:<week>` keys that
//       already exist from every run, manual or scheduled.
//
// netlify.toml is NOT changed as part of this pass -- actually wiring
// a schedule that invokes scheduled mode is a deliberately separate,
// later step.
// ═══════════════════════════════════════════════════════════════════

const { connectLambda, getStore } = require("@netlify/blobs");

const TANK01_HOST = "tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com";
const TARGET_POSITIONS = ["RB", "WR", "TE"];
const REGULAR_SEASON_MAX_WEEK = 18;

async function fetchTank01(endpoint, params = {}) {
  const queryString = new URLSearchParams(params).toString();
  const url = `https://${TANK01_HOST}/${endpoint}${queryString ? "?" + queryString : ""}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "x-rapidapi-host": TANK01_HOST,
      "x-rapidapi-key": process.env.TANK01_API_KEY,
    },
  });

  if (!response.ok) {
    throw new Error(`Tank01 API error: ${response.status} on ${endpoint}`);
  }

  return await response.json();
}

async function fetchGameIDsForWeek(week, season) {
  try {
    const resp = await fetchTank01("getNFLGamesForWeek", {
      week: String(week),
      season: String(season),
    });

    const games = Array.isArray(resp?.body) ? resp.body : [];

    return games
      .filter((g) => g.gameStatusCode === "2")
      .map((g) => ({
        gameID: g.gameID,
        week: Number(week),
      }))
      .filter((g) => Boolean(g.gameID));
  } catch (e) {
    console.log(
      `fetchGameIDsForWeek failed for week ${week}, season ${season}:`,
      e.message
    );
    return [];
  }
}

async function fetchPlayerStatsForGames(gameEntries) {
  const results = await Promise.allSettled(
    gameEntries.map((g) =>
      fetchTank01("getNFLBoxScore", {
        gameID: g.gameID,
      })
    )
  );

  const allPlayers = [];
  const failedGameIDs = [];

  results.forEach((result, i) => {
    const { gameID, week } = gameEntries[i];

    if (result.status === "fulfilled") {
      const playerStats = result.value?.body?.playerStats;

      if (playerStats && typeof playerStats === "object") {
        Object.values(playerStats).forEach((p) =>
          allPlayers.push(
            Object.assign({}, p, {
              week,
              gameID,
            })
          )
        );
      } else {
        console.log(`No playerStats object in box score for ${gameID}`);
        failedGameIDs.push(gameID);
      }
    } else {
      console.log(
        `Box score fetch failed for ${gameID}:`,
        result.reason?.message
      );
      failedGameIDs.push(gameID);
    }
  });

  return {
    allPlayers,
    failedGameIDs,
  };
}

function extractOpportunitiesFromStatLine(statLine) {
  if (!statLine || typeof statLine !== "object") {
    return null;
  }

  const rushingObj = statLine.Rushing;
  const receivingObj = statLine.Receiving;

  const carriesRaw =
    rushingObj && rushingObj.carries !== undefined
      ? rushingObj.carries
      : 0;

  const targetsRaw =
    receivingObj && receivingObj.targets !== undefined
      ? receivingObj.targets
      : 0;

  const carries = parseInt(carriesRaw, 10);
  const targets = parseInt(targetsRaw, 10);

  if (isNaN(carries) || isNaN(targets)) {
    return null;
  }

  return {
    carries,
    targets,
    opportunities: carries + targets,
  };
}

function buildOpportunityIntelligence(validGames, position) {
  const sorted = validGames
    .slice()
    .sort((a, b) => a.week - b.week);

  const opportunitiesMetrics =
    windowedMetrics(
      sorted,
      (g) => g.opportunities
    );

  const rushingMetrics =
    windowedMetrics(
      sorted,
      (g) => g.carries
    );

  const receivingMetrics =
    windowedMetrics(
      sorted,
      (g) => g.targets
    );

  const persistence =
    buildPersistenceEvidence(sorted);

  const signals =
    buildSignals(
      sorted,
      opportunitiesMetrics,
      rushingMetrics,
      receivingMetrics,
      position
    );

  return {
    opportunities: opportunitiesMetrics,

    meta: {
      computedAt: new Date().toISOString(),
      sourcePositions: [position],
    },

    historical: {},

    rushing: rushingMetrics,

    receiving: receivingMetrics,

    highValue: {},

    persistence,

    signals,
  };
}

function windowedMetrics(sortedGames, valueFn) {
  const n = sortedGames.length;

  const values =
    sortedGames.map((g) => ({
      week: g.week,
      value: valueFn(g),
    }));

  const lastGame =
    n >= 1
      ? values[n - 1].value
      : null;

  const avgLast3 =
    n >= 3
      ? averageValues(
          values.slice(-3)
        )
      : null;

  const avgLast5 =
    n >= 5
      ? averageValues(
          values.slice(-5)
        )
      : null;

  const seasonAvg =
    n >= 1
      ? averageValues(values)
      : null;

  let trend = null;

  if (n >= 6) {
    const last3 =
      averageValues(
        values.slice(-3)
      );

    const prev3 =
      averageValues(
        values.slice(-6, -3)
      );

    trend =
      round2(
        last3 - prev3
      );
  }

  return {
    lastGame,

    avgLast3:
      avgLast3 === null
        ? null
        : round2(avgLast3),

    avgLast5:
      avgLast5 === null
        ? null
        : round2(avgLast5),

    seasonAvg:
      seasonAvg === null
        ? null
        : round2(seasonAvg),

    trend,

    gamesSampled: n,
  };
}

function averageValues(entries) {
  return entries.reduce(
    (sum, e) => sum + e.value,
    0
  ) / entries.length;
}

// ═══════════════════════════════════════════════════════════════════
// MULTI-HORIZON PERSISTENCE EVIDENCE
//
// 3-game  = early signal
// 6-game  = meaningful confirmation
// 10-game = sustained evidence
//
// Each window compares the recent N valid games to all valid games
// BEFORE that window.
//
// This deliberately avoids comparing the recent window against a
// season average that contains the same recent games.
//
// A persistence horizon requires:
//   - the full requested recent window
//   - at least 3 earlier valid games to establish a baseline
//
// If either requirement is absent, that horizon remains null rather
// than manufacturing certainty.
// ═══════════════════════════════════════════════════════════════════

const PERSISTENCE_MIN_BASELINE_GAMES = 3;

function buildPersistenceWindow(
  sortedGames,
  windowSize
) {
  const n = sortedGames.length;

  const baselineCount =
    n - windowSize;

  if (
    n < windowSize ||
    baselineCount <
      PERSISTENCE_MIN_BASELINE_GAMES
  ) {
    return null;
  }

  const recentGames =
    sortedGames.slice(-windowSize);

  const baselineGames =
    sortedGames.slice(
      0,
      -windowSize
    );

  const recentAvg =
    averageValues(
      recentGames.map((g) => ({
        value:
          g.opportunities,
      }))
    );

  const baselineAvg =
    averageValues(
      baselineGames.map((g) => ({
        value:
          g.opportunities,
      }))
    );

  const absoluteDelta =
    round2(
      recentAvg -
        baselineAvg
    );

  const percentDelta =
    baselineAvg !== 0
      ? round2(
          (
            absoluteDelta /
            baselineAvg
          ) * 100
        )
      : null;

  return {
    windowGames:
      windowSize,

    recentGames:
      recentGames.length,

    baselineGames:
      baselineGames.length,

    recentAvg:
      round2(recentAvg),

    baselineAvg:
      round2(baselineAvg),

    absoluteDelta,

    percentDelta,
  };
}

function buildPersistenceEvidence(
  sortedGames
) {
  return {
    gamesSampled:
      sortedGames.length,

    last3:
      buildPersistenceWindow(
        sortedGames,
        3
      ),

    last6:
      buildPersistenceWindow(
        sortedGames,
        6
      ),

    last10:
      buildPersistenceWindow(
        sortedGames,
        10
      ),
  };
}

const SIGNAL_MIN_GAMES_FOR_ROLE = 1;

const SIGNAL_ROLE_DOMINANT_SHARE = 0.7;

const SIGNAL_TREND_EXPANDING = 3;

const SIGNAL_TREND_DECLINING = -3;

const SIGNAL_VOLUME_TIERS = {
  RB: {
    highVolume: 18,
    moderateVolume: 10,
  },

  WR: {
    highVolume: 8,
    moderateVolume: 5,
  },

  TE: {
    highVolume: 7,
    moderateVolume: 4,
  },
};

const SIGNAL_LIMITED_SAMPLE_GAMES = 3;

function buildSignals(
  sortedGames,
  opportunitiesMetrics,
  rushingMetrics,
  receivingMetrics,
  position
) {
  const signals = [];

  const n =
    sortedGames.length;

  if (n >= 1) {
    signals.push({
      type:
        "sampleSize",

      value:
        n <
        SIGNAL_LIMITED_SAMPLE_GAMES
          ? "limited"
          : "adequate",

      detail: {
        gamesSampled: n,
        threshold:
          SIGNAL_LIMITED_SAMPLE_GAMES,
      },
    });
  }

  const roleBasis =
    rushingMetrics.avgLast3 !== null &&
    receivingMetrics.avgLast3 !== null
      ? {
          carries:
            rushingMetrics.avgLast3,

          targets:
            receivingMetrics.avgLast3,

          window:
            "avgLast3",
        }
      : n >=
          SIGNAL_MIN_GAMES_FOR_ROLE
      ? {
          carries:
            rushingMetrics.lastGame,

          targets:
            receivingMetrics.lastGame,

          window:
            "lastGame",
        }
      : null;

  if (roleBasis) {
    const total =
      roleBasis.carries +
      roleBasis.targets;

    if (total > 0) {
      const carriesShare =
        roleBasis.carries /
        total;

      const targetsShare =
        roleBasis.targets /
        total;

      let value =
        "balanced";

      if (
        carriesShare >=
        SIGNAL_ROLE_DOMINANT_SHARE
      ) {
        value =
          "rushing-dominant";
      } else if (
        targetsShare >=
        SIGNAL_ROLE_DOMINANT_SHARE
      ) {
        value =
          "receiving-dominant";
      }

      signals.push({
        type:
          "roleComposition",

        value,

        detail: {
          carriesShare:
            round2(
              carriesShare
            ),

          targetsShare:
            round2(
              targetsShare
            ),

          basedOn:
            roleBasis.window,
        },
      });
    }
  }

  if (
    opportunitiesMetrics.trend !==
    null
  ) {
    let value =
      "stable";

    if (
      opportunitiesMetrics.trend >=
      SIGNAL_TREND_EXPANDING
    ) {
      value =
        "expanding";
    } else if (
      opportunitiesMetrics.trend <=
      SIGNAL_TREND_DECLINING
    ) {
      value =
        "declining";
    }

    signals.push({
      type:
        "trendClassification",

      value,

      detail: {
        trend:
          opportunitiesMetrics.trend,

        expandingThreshold:
          SIGNAL_TREND_EXPANDING,

        decliningThreshold:
          SIGNAL_TREND_DECLINING,
      },
    });
  }

  const volumeBasis =
    opportunitiesMetrics.avgLast3 !==
    null
      ? opportunitiesMetrics.avgLast3
      : opportunitiesMetrics.lastGame !==
          null
      ? opportunitiesMetrics.lastGame
      : null;

  const tiers =
    SIGNAL_VOLUME_TIERS[position];

  if (
    volumeBasis !== null &&
    tiers
  ) {
    let value =
      "role-player";

    if (
      volumeBasis >=
      tiers.highVolume
    ) {
      value =
        "high-volume";
    } else if (
      volumeBasis >=
      tiers.moderateVolume
    ) {
      value =
        "moderate-volume";
    }

    signals.push({
      type:
        "volumeTier",

      value,

      detail: {
        basisValue:
          volumeBasis,

        position,

        highVolumeThreshold:
          tiers.highVolume,

        moderateVolumeThreshold:
          tiers.moderateVolume,
      },
    });
  }

  const recentBasis =
    opportunitiesMetrics.avgLast5 !==
    null
      ? {
          value:
            opportunitiesMetrics.avgLast5,

          window:
            "avgLast5",
        }
      : opportunitiesMetrics.avgLast3 !==
          null
      ? {
          value:
            opportunitiesMetrics.avgLast3,

          window:
            "avgLast3",
        }
      : opportunitiesMetrics.lastGame !==
          null
      ? {
          value:
            opportunitiesMetrics.lastGame,

          window:
            "lastGame",
        }
      : null;

  const baseline =
    opportunitiesMetrics.seasonAvg;

  if (
    recentBasis !== null &&
    baseline !== null
  ) {
    const absoluteDelta =
      round2(
        recentBasis.value -
          baseline
      );

    const percentDelta =
      baseline !== 0
        ? round2(
            (
              absoluteDelta /
              baseline
            ) * 100
          )
        : null;

    signals.push({
      type:
        "recentRoleVsBaseline",

      value:
        "unclassified",

      detail: {
        recentValue:
          recentBasis.value,

        recentWindow:
          recentBasis.window,

        baselineValue:
          baseline,

        baselineWindow:
          "seasonAvg",

        absoluteDelta,

        percentDelta,
      },
    });
  }

  return signals;
}

function round2(n) {
  return (
    Math.round(n * 100) /
    100
  );
}

function normalizePlayerName(name) {
  return (name || "")
    .toLowerCase()

    .replace(
      /[.\u0027\u2018\u2019]/g,
      ""
    )

    .replace(
      /-/g,
      " "
    )

    .replace(
      /\b(jr|sr|ii|iii|iv)\b/g,
      ""
    )

    .replace(
      /\s+/g,
      " "
    )

    .trim();
}

function deriveCurrentSeason(now) {
  const month =
    now.getUTCMonth();

  const year =
    now.getUTCFullYear();

  return String(
    month >= 7
      ? year
      : year - 1
  );
}

function deriveMaxCachedWeek(
  records
) {
  let max = 0;

  Object.values(
    records || {}
  ).forEach((record) => {
    (
      record._rawGames ||
      []
    ).forEach((g) => {
      if (
        typeof g.week ===
          "number" &&
        g.week > max
      ) {
        max =
          g.week;
      }
    });
  });

  return max;
}

function mergeGamesForPlayer(
  existingGames,
  newGames
) {
  const byGameID = {};

  (
    existingGames || []
  ).forEach((g) => {
    byGameID[g.gameID] =
      g;
  });

  (
    newGames || []
  ).forEach((g) => {
    byGameID[g.gameID] =
      g;
  });

  return Object.values(
    byGameID
  ).sort(
    (a, b) =>
      a.week - b.week
  );
}

exports.handler =
  async (event) => {
    connectLambda(event);

    const params =
      event.queryStringParameters ||
      {};

    const isManualMode =
      Boolean(
        params.weeks ||
        params.season
      );

    if (isManualMode) {
      return runManualRefresh(
        params
      );
    }

    return runScheduledRefresh();
  };

async function runManualRefresh(
  params
) {
  const season =
    params.season ||
    "2026";

  const weeks =
    params.weeks
      ? params.weeks
          .split(",")
          .map((w) =>
            parseInt(
              w.trim(),
              10
            )
          )
          .filter(
            (w) =>
              !isNaN(w)
          )
      : [1, 2, 3];

  console.log(
    `Opportunity Intelligence manual refresh: fetching weeks [${weeks.join(
      ","
    )}], season ${season}`
  );

  const gameEntryLists =
    await Promise.all(
      weeks.map((w) =>
        fetchGameIDsForWeek(
          w,
          season
        )
      )
    );

  const allGameEntries =
    [].concat(
      ...gameEntryLists
    );

  if (
    allGameEntries.length ===
    0
  ) {
    const msg =
      `No completed games found for weeks [${weeks.join(
        ","
      )}], season ${season} -- aborting, nothing cached.`;

    console.log(msg);

    return {
      statusCode: 200,

      body:
        JSON.stringify({
          skipped: true,
          reason: msg,
        }),
    };
  }

  const {
    allPlayers,
    failedGameIDs,
  } =
    await fetchPlayerStatsForGames(
      allGameEntries
    );

  let positionLookup = {};

  try {
    const store =
      getStore({
        name:
          "player-data",
      });

    const cached =
      await store.get(
        "playerData",
        {
          type:
            "json",
        }
      );

    if (
      cached?.players
    ) {
      positionLookup =
        cached.players;
    }
  } catch (e) {
    console.log(
      "player-data cache read failed (non-fatal, all players will be excluded this run):",
      e.message
    );
  }

  const perPlayerGames = {};

  const normalizationFailures =
    [];

  let excludedNoPositionMatch =
    0;

  allPlayers.forEach(
    (statLine) => {
      const playerID =
        statLine.playerID;

      if (!playerID) {
        return;
      }

      const posInfo =
        positionLookup[
          playerID
        ];

      if (
        !posInfo ||
        !posInfo.pos ||
        TARGET_POSITIONS.indexOf(
          posInfo.pos
        ) === -1
      ) {
        excludedNoPositionMatch++;
        return;
      }

      const extracted =
        extractOpportunitiesFromStatLine(
          statLine
        );

      if (
        extracted ===
        null
      ) {
        normalizationFailures.push({
          playerID,

          longName:
            statLine.longName,

          gameID:
            statLine.gameID,

          week:
            statLine.week,
        });

        return;
      }

      if (
        !perPlayerGames[
          playerID
        ]
      ) {
        perPlayerGames[
          playerID
        ] = {
          longName:
            statLine.longName,

          pos:
            posInfo.pos,

          games: [],
        };
      }

      perPlayerGames[
        playerID
      ].games.push({
        week:
          statLine.week,

        gameID:
          statLine.gameID,

        carries:
          extracted.carries,

        targets:
          extracted.targets,

        opportunities:
          extracted.opportunities,
      });
    }
  );

  const records = {};

  Object.keys(
    perPlayerGames
  ).forEach(
    (playerID) => {
      const {
        longName,
        pos,
        games,
      } =
        perPlayerGames[
          playerID
        ];

      const key =
        `${normalizePlayerName(
          longName
        )}|${pos}`;

      records[key] =
        Object.assign(
          {
            playerID,
            longName,
            pos,
          },

          buildOpportunityIntelligence(
            games,
            pos
          )
        );

      records[
        key
      ]._rawGames =
        games
          .slice()
          .sort(
            (a, b) =>
              a.week -
              b.week
          );
    }
  );

  const result = {
    computedAt:
      new Date().toISOString(),

    season,

    weeksRequested:
      weeks,

    mode:
      "manual",

    gamesFound:
      allGameEntries.length,

    gamesFailed:
      failedGameIDs.length,

    playersRecorded:
      Object.keys(
        records
      ).length,

    excludedNoPositionMatch,

    normalizationFailures,

    records,
  };

  try {
    const store =
      getStore({
        name:
          "opportunity-intel",
      });

    await store.setJSON(
      `window:${season}:${weeks.join(
        "-"
      )}`,
      result
    );

    await store.setJSON(
      "latest",
      result
    );

    console.log(
      `Opportunity Intelligence cached: ${Object.keys(
        records
      ).length} players, ${allGameEntries.length} games fetched (${failedGameIDs.length} failed), ${excludedNoPositionMatch} stat lines excluded (no RB/WR/TE position match), ${normalizationFailures.length} normalization failures`
    );
  } catch (e) {
    console.log(
      "Failed to write opportunity-intel cache:",
      e.message
    );

    return {
      statusCode: 500,

      body:
        JSON.stringify({
          error:
            "Cache write failed",

          detail:
            e.message,
        }),
    };
  }

  return {
    statusCode: 200,

    body:
      JSON.stringify({
        mode:
          "manual",

        season,

        weeksRequested:
          weeks,

        gamesFound:
          allGameEntries.length,

        gamesFailed:
          failedGameIDs.length,

        playersRecorded:
          Object.keys(
            records
          ).length,

        excludedNoPositionMatch,

        normalizationFailureCount:
          normalizationFailures.length,

        writeOccurred:
          true,
      }),
  };
}

async function runScheduledRefresh() {
  const derivedSeason =
    deriveCurrentSeason(
      new Date()
    );

  const store =
    getStore({
      name:
        "opportunity-intel",
    });

  let existingLatest =
    null;

  try {
    existingLatest =
      await store.get(
        "latest",
        {
          type:
            "json",
        }
      );
  } catch (e) {
    console.log(
      "Scheduled refresh: could not read existing 'latest' cache (treated as absent):",
      e.message
    );
  }

  const seasonRollover =
    !existingLatest ||
    existingLatest.season !==
      derivedSeason;

  const priorCachedMaxWeek =
    seasonRollover
      ? 0
      : deriveMaxCachedWeek(
          existingLatest.records
        );

  const targetWeek =
    priorCachedMaxWeek +
    1;

  if (
    targetWeek >
    REGULAR_SEASON_MAX_WEEK
  ) {
    return scheduledNoOp({
      derivedSeason,

      seasonRollover,

      priorCachedMaxWeek,

      targetWeek,

      noOpReason:
        `Derived next week (${targetWeek}) is beyond the regular season (max ${REGULAR_SEASON_MAX_WEEK}) -- nothing to do until next season.`,
    });
  }

  console.log(
    `Opportunity Intelligence scheduled refresh: season ${derivedSeason}, target week ${targetWeek}${
      seasonRollover
        ? " (new season)"
        : ""
    }`
  );

  const gameEntries =
    await fetchGameIDsForWeek(
      targetWeek,
      derivedSeason
    );

  if (
    gameEntries.length ===
    0
  ) {
    return scheduledNoOp({
      derivedSeason,

      seasonRollover,

      priorCachedMaxWeek,

      targetWeek,

      noOpReason:
        `No completed games found yet for week ${targetWeek}, season ${derivedSeason} -- nothing to do this run.`,
    });
  }

  const {
    allPlayers,
    failedGameIDs,
  } =
    await fetchPlayerStatsForGames(
      gameEntries
    );

  let positionLookup = {};

  try {
    const playerDataStore =
      getStore({
        name:
          "player-data",
      });

    const cachedPlayerData =
      await playerDataStore.get(
        "playerData",
        {
          type:
            "json",
        }
      );

    if (
      cachedPlayerData?.players
    ) {
      positionLookup =
        cachedPlayerData.players;
    }
  } catch (e) {
    console.log(
      "Scheduled refresh: player-data cache read failed (non-fatal, all players excluded this run):",
      e.message
    );
  }

  const newGamesByPlayer =
    {};

  const normalizationFailures =
    [];

  let excludedNoPositionMatch =
    0;

  allPlayers.forEach(
    (statLine) => {
      const playerID =
        statLine.playerID;

      if (!playerID) {
        return;
      }

      const posInfo =
        positionLookup[
          playerID
        ];

      if (
        !posInfo ||
        !posInfo.pos ||
        TARGET_POSITIONS.indexOf(
          posInfo.pos
        ) === -1
      ) {
        excludedNoPositionMatch++;
        return;
      }

      const extracted =
        extractOpportunitiesFromStatLine(
          statLine
        );

      if (
        extracted ===
        null
      ) {
        normalizationFailures.push({
          playerID,

          longName:
            statLine.longName,

          gameID:
            statLine.gameID,

          week:
            statLine.week,
        });

        return;
      }

      if (
        !newGamesByPlayer[
          playerID
        ]
      ) {
        newGamesByPlayer[
          playerID
        ] = {
          longName:
            statLine.longName,

          pos:
            posInfo.pos,

          games: [],
        };
      }

      newGamesByPlayer[
        playerID
      ].games.push({
        week:
          statLine.week,

        gameID:
          statLine.gameID,

        carries:
          extracted.carries,

        targets:
          extracted.targets,

        opportunities:
          extracted.opportunities,
      });
    }
  );

  if (
    failedGameIDs.length >
      0 ||
    normalizationFailures.length >
      0
  ) {
    return {
      statusCode: 200,

      body:
        JSON.stringify(
          {
            mode:
              "scheduled",

            derivedSeason,

            seasonRollover,

            priorCachedMaxWeek,

            targetWeek,

            noOp:
              false,

            gamesFound:
              gameEntries.length,

            gamesFailed:
              failedGameIDs.length,

            normalizationFailureCount:
              normalizationFailures.length,

            writeOccurred:
              false,

            writeBlockedReason:
              `${failedGameIDs.length} box-score fetch failure(s) and/or ${normalizationFailures.length} normalization failure(s) for week ${targetWeek} -- refusing to write an incomplete week.`,

            failedGameIDs,

            normalizationFailures,
          },
          null,
          2
        ),
    };
  }

  const mergedRecords =
    {};

  if (!seasonRollover) {
    Object.assign(
      mergedRecords,
      existingLatest.records
    );
  }

  let mergeLostGames =
    false;

  Object.keys(
    newGamesByPlayer
  ).forEach(
    (playerID) => {
      const {
        longName,
        pos,
        games:
          thisWeekGames,
      } =
        newGamesByPlayer[
          playerID
        ];

      const key =
        `${normalizePlayerName(
          longName
        )}|${pos}`;

      const existingRecord =
        mergedRecords[key];

      const existingGames =
        existingRecord
          ? existingRecord._rawGames
          : [];

      const mergedGames =
        mergeGamesForPlayer(
          existingGames,
          thisWeekGames
        );

      const existingIDs =
        new Set(
          (
            existingGames ||
            []
          ).map(
            (g) =>
              g.gameID
          )
        );

      const mergedIDs =
        new Set(
          mergedGames.map(
            (g) =>
              g.gameID
          )
        );

      existingIDs.forEach(
        (id) => {
          if (
            !mergedIDs.has(
              id
            )
          ) {
            mergeLostGames =
              true;
          }
        }
      );

      mergedRecords[
        key
      ] =
        Object.assign(
          {
            playerID,
            longName,
            pos,
          },

          buildOpportunityIntelligence(
            mergedGames,
            pos
          )
        );

      mergedRecords[
        key
      ]._rawGames =
        mergedGames;
    }
  );

  if (mergeLostGames) {
    return {
      statusCode: 200,

      body:
        JSON.stringify(
          {
            mode:
              "scheduled",

            derivedSeason,

            seasonRollover,

            priorCachedMaxWeek,

            targetWeek,

            noOp:
              false,

            gamesFound:
              gameEntries.length,

            gamesFailed:
              failedGameIDs.length,

            normalizationFailureCount:
              normalizationFailures.length,

            writeOccurred:
              false,

            writeBlockedReason:
              "Merge would have dropped one or more previously-cached games -- refusing to write. This should not be possible under normal union logic; investigate before retrying.",
          },
          null,
          2
        ),
    };
  }

  const result = {
    computedAt:
      new Date().toISOString(),

    season:
      derivedSeason,

    weeksRequested: [
      targetWeek,
    ],

    mode:
      "scheduled",

    seasonRollover,

    gamesFound:
      gameEntries.length,

    gamesFailed:
      failedGameIDs.length,

    playersRecorded:
      Object.keys(
        mergedRecords
      ).length,

    excludedNoPositionMatch,

    normalizationFailures,

    records:
      mergedRecords,
  };

  try {
    if (
      seasonRollover &&
      existingLatest
    ) {
      await store.setJSON(
        `season:${existingLatest.season}:final`,
        existingLatest
      );
    }

    await store.setJSON(
      `window:${derivedSeason}:${targetWeek}`,
      result
    );

    await store.setJSON(
      "latest",
      result
    );

    console.log(
      `Opportunity Intelligence scheduled refresh cached: season ${derivedSeason}, week ${targetWeek}, ${Object.keys(
        newGamesByPlayer
      ).length} players updated this run, ${Object.keys(
        mergedRecords
      ).length} total players in cache${
        seasonRollover
          ? " (new season)"
          : ""
      }`
    );
  } catch (e) {
    console.log(
      "Scheduled refresh: failed to write opportunity-intel cache:",
      e.message
    );

    return {
      statusCode: 500,

      body:
        JSON.stringify({
          error:
            "Cache write failed",

          detail:
            e.message,
        }),
    };
  }

  return {
    statusCode: 200,

    body:
      JSON.stringify(
        {
          mode:
            "scheduled",

          derivedSeason,

          seasonRollover,

          priorCachedMaxWeek,

          targetWeek,

          noOp:
            false,

          gamesFound:
            gameEntries.length,

          gamesFailed:
            failedGameIDs.length,

          normalizationFailureCount:
            normalizationFailures.length,

          playersUpdatedThisRun:
            Object.keys(
              newGamesByPlayer
            ).length,

          playersRecordedTotal:
            Object.keys(
              mergedRecords
            ).length,

          writeOccurred:
            true,

          writeBlockedReason:
            null,
        },
        null,
        2
      ),
  };
}

function scheduledNoOp({
  derivedSeason,
  seasonRollover,
  priorCachedMaxWeek,
  targetWeek,
  noOpReason,
}) {
  console.log(
    `Opportunity Intelligence scheduled refresh: no-op -- ${noOpReason}`
  );

  return {
    statusCode: 200,

    body:
      JSON.stringify(
        {
          mode:
            "scheduled",

          derivedSeason,

          seasonRollover,

          priorCachedMaxWeek,

          targetWeek,

          noOp:
            true,

          noOpReason,

          writeOccurred:
            false,

          writeBlockedReason:
            null,
        },
        null,
        2
      ),
  };
}

module.exports.extractOpportunitiesFromStatLine =
  extractOpportunitiesFromStatLine;

module.exports.buildOpportunityIntelligence =
  buildOpportunityIntelligence;

module.exports.normalizePlayerName =
  normalizePlayerName;

module.exports.windowedMetrics =
  windowedMetrics;

module.exports.buildPersistenceWindow =
  buildPersistenceWindow;

module.exports.buildPersistenceEvidence =
  buildPersistenceEvidence;

module.exports.buildSignals =
  buildSignals;

module.exports.deriveCurrentSeason =
  deriveCurrentSeason;

module.exports.deriveMaxCachedWeek =
  deriveMaxCachedWeek;

module.exports.mergeGamesForPlayer =
  mergeGamesForPlayer;

module.exports.REGULAR_SEASON_MAX_WEEK =
  REGULAR_SEASON_MAX_WEEK;
