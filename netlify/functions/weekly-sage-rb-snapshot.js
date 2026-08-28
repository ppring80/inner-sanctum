// netlify/functions/weekly-sage-rb-snapshot.js
//
// WEEKLY SAGE — RB BENCHMARK SNAPSHOT
//
// PURPOSE
// -------
// Build the RB peer population ONCE for a season/week and reuse it.
//
// This replaces the expensive pattern:
//
//   player request
//     -> rebuild all RB benchmarks
//     -> dozens of Tank01 calls
//
// with:
//
//   weekly RB snapshot
//     -> build once
//     -> cache
//     -> reuse for every RB
//
// IMPORTANT
// ---------
// This function DOES NOT:
// - calculate START / FLEX / SIT
// - calculate a final SAGE score
// - calculate player-specific matchup
// - call getNFLPlayerInfo for every RB
// - call getNFLPlayerList or read the player-data cache to discover
//   or gate candidates (see HISTORICAL CANDIDATE DISCOVERY below --
//   both are CURRENT-roster-only sources and produced an incomplete/
//   incorrect candidate universe for any historical rebuild)
//
// HISTORICAL CANDIDATE DISCOVERY (replaces the prior getNFLPlayerList
// approach)
// -----------------------------------------------------------------
// getNFLPlayerList?all=true returns Tank01's CURRENT player list, not
// a season/week-scoped historical one. Rebuilding a past week's
// snapshot against it silently drops any RB who has since retired,
// been cut, or changed teams/status -- confirmed as the root cause of
// an incomplete 2025 Week 8 RB population (68 discovered, only 12
// eligible).
//
// RB candidates are now discovered directly from actual historical
// rushing evidence in every unique box score across the SAME
// Weeks 1 through targetWeek-1 window already used for no-look-ahead
// schedule classification (see buildScheduleMap() below, now called
// FIRST so its gameMap's game IDs are available for this step). Each
// unique gameID is fetched via getNFLBoxScore exactly once -- never
// once per player, never once per week redundantly. A player with
// real Rushing.carries in any scanned box score is a discovery
// candidate; a player who ALSO shows genuine Passing evidence
// (presence of Tank01's own Passing stat block at all -- not a new
// numeric threshold) in any scanned game is excluded as an obvious
// passing-role player (e.g. a scrambling QB with called runs). This
// intentionally does NOT attempt to separate a true low-volume RB
// from a gadget-play WR via any new numeric cutoff -- see this
// file's own design-discussion history: the existing, UNCHANGED
// MIN_GAMES / MIN_OPPORTUNITIES_PER_GAME eligibility filter below
// already absorbs most of that remaining over-inclusion risk,
// downstream, without any new classification rule.
//
// Tank01 calls:
//   1 x getNFLGamesForWeek per prior week (via weekly-sage-schedule,
//       unchanged -- already made for no-look-ahead scheduling)
//   1 x getNFLBoxScore per UNIQUE historical game across Weeks 1
//       through targetWeek-1 (new -- replaces the single
//       getNFLPlayerList call)
//   1 x getNFLGamesForPlayer per discovered RB (unchanged)
//
// Schedule:
//   Weekly SAGE schedule is fetched once for each prior week.
//
// NO-LOOK-AHEAD:
//   Week 8 snapshot uses only Weeks 1-7.
//
// ═══════════════════════════════════════════════════════════════════════

const TANK01_HOST =
  "tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com";

const DEFAULT_SEASON_TYPE =
  "reg";

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

// Keep Tank01 pressure intentionally low.
const PLAYER_CONCURRENCY = 2;

const MIN_GAMES = 2;
const MIN_OPPORTUNITIES_PER_GAME = 5;

// Warm-function cache.
// CDN caching remains the main reusable cache.
const MEMORY_CACHE_TTL_MS =
  6 * 60 * 60 * 1000;

const memoryCache =
  new Map();

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

function normalizePosition(value) {
  return String(
    value || ""
  )
    .trim()
    .toUpperCase();
}

function normalizeTeam(value) {
  const raw =
    String(
      value || ""
    )
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

  return (
    aliases[raw] ||
    raw
  );
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
    (
      query
        ? `?${query}`
        : ""
    );

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

    throw new Error(
      detail
    );
  }

  return data;
}

function unwrapBody(data) {
  if (
    data &&
    typeof data === "object" &&
    Object.prototype
      .hasOwnProperty
      .call(
        data,
        "body"
      )
  ) {
    let body =
      data.body;

    if (
      typeof body ===
      "string"
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

  if (
    Array.isArray(body)
  ) {
    return body;
  }

  if (
    body &&
    Array.isArray(
      body.players
    )
  ) {
    return body.players;
  }

  if (
    data &&
    Array.isArray(
      data.players
    )
  ) {
    return data.players;
  }

  return [];
}

function extractPlayerGames(data) {
  const body =
    unwrapBody(data);

  if (!body) {
    return [];
  }

  if (
    Array.isArray(body)
  ) {
    return body;
  }

  if (
    typeof body ===
    "object"
  ) {
    return Object.entries(
      body
    ).map(
      ([
        gameID,
        game
      ]) => ({
        ...(game || {}),

        gameID:
          (
            game &&
            game.gameID
          ) ||
          gameID
      })
    );
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

function playerPositionOf(player) {
  return normalizePosition(
    player.pos ??
    player.position ??
    player.positionAbv ??
    ""
  );
}

function playerTeamOf(player) {
  return normalizeTeam(
    player.teamAbv ??
    player.team ??
    player.teamAbbr ??
    ""
  );
}

function statBlock(
  game,
  key
) {
  if (
    !game ||
    !game[key] ||
    typeof game[key] !==
      "object"
  ) {
    return {};
  }

  return game[key];
}

function rushingStats(game) {
  const stats =
    statBlock(
      game,
      "Rushing"
    );

  return {
    carries:
      num(
        stats.carries ??
        stats.rushAttempts
      ),

    yards:
      num(
        stats.rushYds ??
        stats.rushYards
      ),

    touchdowns:
      num(
        stats.rushTD ??
        stats.rushTouchdowns
      )
  };
}

function receivingStats(game) {
  const stats =
    statBlock(
      game,
      "Receiving"
    );

  return {
    targets:
      num(
        stats.targets
      ),

    receptions:
      num(
        stats.receptions ??
        stats.rec
      ),

    yards:
      num(
        stats.recYds ??
        stats.receivingYards
      ),

    touchdowns:
      num(
        stats.recTD ??
        stats.receivingTD
      )
  };
}

function snapStats(game) {
  const stats =
    statBlock(
      game,
      "snapCounts"
    );

  const offense =
    num(
      stats.offSnap ??
      stats.offense ??
      stats.offensiveSnaps ??
      stats.offSnaps
    );

  let offensePct =
    num(
      stats.offSnapPct ??
      stats.offensePct ??
      stats.offensiveSnapPct
    );

  if (
    offensePct > 0 &&
    offensePct <= 1
  ) {
    offensePct *= 100;
  }

  return {
    offense,
    offensePct
  };
}

async function fetchScheduleWeek({
  baseUrl,
  season,
  week,
  seasonType
}) {
  const url =
    `${baseUrl}/.netlify/functions/weekly-sage-schedule` +
    `?season=${encodeURIComponent(season)}` +
    `&week=${encodeURIComponent(week)}` +
    `&seasonType=${encodeURIComponent(seasonType)}`;

  const data =
    await fetchJson(url);

  return {
    week,

    games:
      Array.isArray(
        data.games
      )
        ? data.games
        : []
  };
}

async function buildScheduleMap({
  baseUrl,
  season,
  targetWeek,
  seasonType
}) {
  const weeks =
    [];

  for (
    let week = 1;
    week < targetWeek;
    week += 1
  ) {
    weeks.push(week);
  }

  /*
    Schedule calls may already be CDN cached.
    Seven Week-8 schedule requests are inexpensive compared
    with rebuilding them for every player.
  */
  const schedules =
    await Promise.all(
      weeks.map(
        week =>
          fetchScheduleWeek({
            baseUrl,
            season,
            week,
            seasonType
          })
      )
    );

  const gameMap =
    new Map();

  for (
    const schedule
    of schedules
  ) {
    for (
      const game
      of schedule.games
    ) {
      if (!game.gameID) {
        continue;
      }

      gameMap.set(
        game.gameID,
        {
          week:
            schedule.week,

          gameID:
            game.gameID,

          away:
            normalizeTeam(
              game.away
            ),

          home:
            normalizeTeam(
              game.home
            ),

          gameDate:
            game.gameDate ||
            null,

          status:
            game.gameStatus ||
            null
        }
      );
    }
  }

  return {
    weeks,
    gameMap
  };
}

function attachPriorGames(
  playerGames,
  gameMap
) {
  const matched =
    [];

  for (
    const game
    of playerGames
  ) {
    const scheduleGame =
      gameMap.get(
        game.gameID
      );

    if (!scheduleGame) {
      continue;
    }

    matched.push({
      ...game,

      sageWeek:
        scheduleGame.week
    });
  }

  matched.sort(
    (a, b) =>
      num(a.sageWeek) -
      num(b.sageWeek)
  );

  return matched;
}

function aggregateRB(
  games
) {
  const totals = {
    games: 0,

    rushing: {
      carries: 0,
      yards: 0,
      touchdowns: 0
    },

    receiving: {
      targets: 0,
      receptions: 0,
      yards: 0,
      touchdowns: 0
    },

    snaps: {
      offense: 0,
      offensePctTotal: 0,
      offensePctGames: 0
    }
  };

  for (
    const game
    of games
  ) {
    const rushing =
      rushingStats(game);

    const receiving =
      receivingStats(game);

    const snaps =
      snapStats(game);

    totals.games += 1;

    totals.rushing.carries +=
      rushing.carries;

    totals.rushing.yards +=
      rushing.yards;

    totals.rushing.touchdowns +=
      rushing.touchdowns;

    totals.receiving.targets +=
      receiving.targets;

    totals.receiving.receptions +=
      receiving.receptions;

    totals.receiving.yards +=
      receiving.yards;

    totals.receiving.touchdowns +=
      receiving.touchdowns;

    totals.snaps.offense +=
      snaps.offense;

    if (
      snaps.offensePct > 0
    ) {
      totals
        .snaps
        .offensePctTotal +=
          snaps.offensePct;

      totals
        .snaps
        .offensePctGames += 1;
    }
  }

  return totals;
}

function buildRBRecord({
  candidate,
  games
}) {
  const totals =
    aggregateRB(
      games
    );

  const gamesUsed =
    totals.games;

  const carries =
    totals.rushing.carries;

  const targets =
    totals.receiving.targets;

  const receptions =
    totals.receiving.receptions;

  const rushingYards =
    totals.rushing.yards;

  const receivingYards =
    totals.receiving.yards;

  const rushingTD =
    totals.rushing.touchdowns;

  const receivingTD =
    totals.receiving.touchdowns;

  const carriesPerGame =
    gamesUsed
      ? round(
          carries /
          gamesUsed
        )
      : 0;

  const targetsPerGame =
    gamesUsed
      ? round(
          targets /
          gamesUsed
        )
      : 0;

  const receptionsPerGame =
    gamesUsed
      ? round(
          receptions /
          gamesUsed
        )
      : 0;

  const rushingYardsPerGame =
    gamesUsed
      ? round(
          rushingYards /
          gamesUsed
        )
      : 0;

  const receivingYardsPerGame =
    gamesUsed
      ? round(
          receivingYards /
          gamesUsed
        )
      : 0;

  const rushingTDPerGame =
    gamesUsed
      ? round(
          rushingTD /
          gamesUsed
        )
      : 0;

  const receivingTDPerGame =
    gamesUsed
      ? round(
          receivingTD /
          gamesUsed
        )
      : 0;

  const offensiveSnapPct =
    totals
      .snaps
      .offensePctGames > 0
      ? round(
          totals
            .snaps
            .offensePctTotal /
          totals
            .snaps
            .offensePctGames,
          1
        )
      : 0;

  return {
    playerID:
      candidate.playerID,

    name:
      candidate.name,

    team:
      candidate.team,

    position:
      "RB",

    gamesUsed,

    weeksIncluded:
      games.map(
        game =>
          game.sageWeek
      ),

    role: {
      carriesPerGame,

      targetsPerGame,

      receptionsPerGame,

      opportunitiesPerGame:
        round(
          carriesPerGame +
          targetsPerGame
        ),

      offensiveSnapPct
    },

    production: {
      rushingYardsPerGame,

      yardsPerCarry:
        carries
          ? round(
              rushingYards /
              carries
            )
          : 0,

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

function eligibilityReason(
  record
) {
  if (
    record.gamesUsed <
    MIN_GAMES
  ) {
    return "insufficient_games";
  }

  if (
    record.role
      .opportunitiesPerGame <
    MIN_OPPORTUNITIES_PER_GAME
  ) {
    return "insufficient_opportunity";
  }

  return null;
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

  async function runner() {
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
          candidate:
            items[index],
          error:
            error.message
        };
      }
    }
  }

  const runnerCount =
    Math.min(
      limit,
      items.length
    );

  const runners =
    [];

  for (
    let i = 0;
    i < runnerCount;
    i += 1
  ) {
    runners.push(
      runner()
    );
  }

  await Promise.all(
    runners
  );

  return results;
}

async function fetchRBPlayerGames({
  candidate,
  season
}) {
  const data =
    await tank01Fetch(
      "getNFLGamesForPlayer",
      {
        playerID:
          candidate.playerID,

        season
      }
    );

  return extractPlayerGames(
    data
  );
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

function buildIneligibleSummary(
  records
) {
  const summary = {
    insufficient_games: 0,
    insufficient_opportunity: 0
  };

  for (
    const record
    of records
  ) {
    const reason =
      eligibilityReason(
        record
      );

    if (
      reason &&
      Object.prototype
        .hasOwnProperty
        .call(
          summary,
          reason
        )
    ) {
      summary[reason] += 1;
    }
  }

  return summary;
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


// ═══════════════════════════════════════════════════════════════════════
// EXTRACTED FOR REUSE (production wiring pass) -- structural extraction
// ONLY. Every line below is copied byte-for-byte from what was previously
// inlined directly in exports.handler's try block; no Role, Production,
// Confidence, eligibility, or scoring logic was changed. baseUrl is now a
// parameter (passed in by the caller) instead of derived from an HTTP
// `event` object, since this function is now ALSO called in-process by
// refresh-rb-snapshot.js -- the same reuse pattern already established by
// weekly-sage-qb-snapshot.js's buildQbSnapshot() (and the WR/TE
// equivalents).
//
// exports.handler below is unchanged in every other respect (its own
// query parsing, warm-function memory cache, and HTTP response shape are
// byte-identical to before this extraction) -- it now calls this function
// instead of inlining the same code.
// ═══════════════════════════════════════════════════════════════════════
async function buildRbSnapshot({
  baseUrl,
  season,
  targetWeek,
  seasonType
}) {
  const cacheKey =
    [
      season,
      targetWeek,
      seasonType
    ].join("|");

      /*
        STEP 1
        ------
        Build Weeks 1 through targetWeek - 1 schedule map ONCE.

        MOVED EARLIER (was STEP 3): candidate discovery below now
        depends on this map's unique game IDs. Nothing about this
        function itself changed.
      */
      const scheduleContext =
        await buildScheduleMap({
          baseUrl,
          season,
          targetWeek,
          seasonType
        });

      /*
        STEP 2
        ------
        Discover RB candidates from actual historical rushing
        evidence in every UNIQUE box score across Weeks 1 through
        targetWeek - 1 -- see this file's header comment for the
        full rationale. Never calls getNFLPlayerList or reads the
        player-data cache to discover or gate candidates.

        Each unique gameID is fetched via getNFLBoxScore exactly
        once, at the same PLAYER_CONCURRENCY already used elsewhere
        in this file to keep Tank01 pressure low -- no new
        concurrency parameter introduced.
      */
      const uniqueGameIDs =
        [
          ...scheduleContext
            .gameMap
            .keys()
        ];

      let boxScoresRetrieved =
        0;

      let boxScoreFailures =
        0;

      const boxScoreResults =
        await mapWithConcurrency(
          uniqueGameIDs,
          PLAYER_CONCURRENCY,
          async gameID => {
            try {
              const data =
                await tank01Fetch(
                  "getNFLBoxScore",
                  { gameID }
                );

              return {
                ok: true,
                gameID,
                data
              };
            } catch (error) {
              return {
                ok: false,
                gameID,
                error:
                  error &&
                  error.message
                    ? error.message
                    : String(
                        error
                      )
              };
            }
          }
        );

      /*
        Deduplicate strictly by playerID across every scanned game.

        rushingCandidateMap: every playerID with real Rushing.carries
        in at least one scanned box score (first occurrence's name/
        team wins -- same "first wins" dedup convention already used
        by the prior getNFLPlayerList-based candidateMap).

        passingEvidencePlayerIDs: every playerID who shows a genuine
        Passing stat block (key presence only, never a numeric value
        threshold) in ANY scanned game -- checked season-wide, not
        per-game, so a single called-run game from an otherwise
        clearly-passing player doesn't inconsistently admit them.
      */
      const rushingCandidateMap =
        new Map();

      const passingEvidencePlayerIDs =
        new Set();

      for (
        const result
        of boxScoreResults
      ) {
        if (
          !result ||
          !result.ok
        ) {
          boxScoreFailures += 1;
          continue;
        }

        boxScoresRetrieved += 1;

        const body =
          unwrapBody(
            result.data
          );

        const playerStats =
          body &&
          body.playerStats &&
          typeof body.playerStats ===
            "object"
            ? body.playerStats
            : {};

        for (
          const [
            playerID,
            statsEntry
          ]
          of Object.entries(
            playerStats
          )
        ) {
          const normalizedID =
            String(
              playerID || ""
            ).trim();

          if (
            !normalizedID ||
            !statsEntry
          ) {
            continue;
          }

          if (
            Object.keys(
              statBlock(
                statsEntry,
                "Passing"
              )
            ).length > 0
          ) {
            passingEvidencePlayerIDs.add(
              normalizedID
            );
          }

          const rushing =
            rushingStats(
              statsEntry
            );

          if (
            rushing.carries > 0 &&
            !rushingCandidateMap.has(
              normalizedID
            )
          ) {
            rushingCandidateMap.set(
              normalizedID,
              {
                playerID:
                  normalizedID,

                name:
                  playerNameOf(
                    statsEntry
                  ),

                team:
                  playerTeamOf(
                    statsEntry
                  )
              }
            );
          }
        }
      }

      let candidatesExcludedForPassingEvidence =
        0;

      const candidateMap =
        new Map();

      for (
        const [
          playerID,
          candidate
        ]
        of rushingCandidateMap
      ) {
        if (
          passingEvidencePlayerIDs.has(
            playerID
          )
        ) {
          candidatesExcludedForPassingEvidence += 1;
          continue;
        }

        candidateMap.set(
          playerID,
          candidate
        );
      }

      const candidates =
        [
          ...candidateMap
            .values()
        ];

      /*
        STEP 3
        ------
        Retrieve one player-games payload per RB.

        No getNFLPlayerInfo calls.

        Concurrency intentionally held at 2 to avoid another request
        burst against Tank01.
      */
      const results =
        await mapWithConcurrency(
          candidates,
          PLAYER_CONCURRENCY,
          async candidate => {
            const playerGames =
              await fetchRBPlayerGames({
                candidate,
                season
              });

            const priorGames =
              attachPriorGames(
                playerGames,
                scheduleContext
                  .gameMap
              );

            const record =
              buildRBRecord({
                candidate,
                games:
                  priorGames
              });

            return {
              ok: true,
              record
            };
          }
        );

      const successful =
        results.filter(
          result =>
            result &&
            result.ok &&
            result.record
        );

      const failures =
        results.filter(
          result =>
            !result ||
            !result.ok
        );

      const records =
        successful.map(
          result =>
            result.record
        );

      const eligible =
        records.filter(
          record =>
            eligibilityReason(
              record
            ) === null
        );

      const sortedPopulation =
        sortPopulation(
          eligible
        );

      const ineligibleSummary =
        buildIneligibleSummary(
          records
        );

      const snapshot =
        {
          evidenceType:
            "weekly-sage-rb-snapshot",

          schemaVersion:
            1,

          generatedAt:
            new Date()
              .toISOString(),

          season,

          targetWeek,

          seasonType,

          snapshotKey:
            cacheKey,

          noLookAhead: {
            rule:
              `Only Weeks 1 through ${targetWeek - 1} are eligible.`,

            weeksQueried:
              scheduleContext.weeks,

            targetWeekExcluded:
              true
          },

          methodology: {
            position:
              "RB",

            minimumGames:
              MIN_GAMES,

            minimumOpportunitiesPerGame:
              MIN_OPPORTUNITIES_PER_GAME,

            tank01PlayerConcurrency:
              PLAYER_CONCURRENCY,

            architecture:
              "Build the RB population once per season/week and reuse the snapshot for player scoring.",

            important:
              "This snapshot contains raw RB peer evidence only. It does not calculate a final SAGE score or recommendation."
          },

          populationSummary: {
            historicalGamesScanned:
              uniqueGameIDs.length,

            boxScoresRetrieved,

            boxScoreFailures,

            uniqueRushingCandidatesDiscovered:
              rushingCandidateMap.size,

            candidatesExcludedForPassingEvidence,

            rbCandidatesDiscovered:
              candidates.length,

            successfulPlayerGameResponses:
              successful.length,

            playerGameFailures:
              failures.length,

            recordsBuilt:
              records.length,

            eligibleRBPopulation:
              sortedPopulation.length,

            ineligible:
              ineligibleSummary
          },

          population:
            sortedPopulation,

          /*
            Keep the non-eligible records during validation.
            This will help us understand why the previous peer
            population contained only a small number of RBs.
          */
          ineligiblePlayers:
            records
              .filter(
                record =>
                  eligibilityReason(
                    record
                  ) !== null
              )
              .map(
                record => ({
                  playerID:
                    record.playerID,

                  name:
                    record.name,

                  team:
                    record.team,

                  gamesUsed:
                    record.gamesUsed,

                  opportunitiesPerGame:
                    record.role
                      .opportunitiesPerGame,

                  reason:
                    eligibilityReason(
                      record
                    )
                })
              ),

          failures:
            failures.map(
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

          /*
            TEMPORARY VALIDATION DIAGNOSTICS -- strictly additive to
            the existing schema. Intended to be removed once
            historical RB box-score discovery has been validated
            against a known week (e.g. 2025 Week 8). Not consumed by
            any leaderboard, final-score, or scoring logic.
          */
          temporaryValidationDiagnostics: {
            note:
              "TEMPORARY -- remove once historical RB box-score discovery is validated.",

            historicalGamesScanned:
              uniqueGameIDs.length,

            boxScoresRetrieved,

            boxScoreFailures,

            uniqueRushingCandidatesDiscovered:
              rushingCandidateMap.size,

            candidatesExcludedForPassingEvidence,

            eligibleRBPopulation:
              sortedPopulation.length,

            eligiblePlayers:
              sortedPopulation.map(
                record => ({
                  playerID:
                    record.playerID,

                  name:
                    record.name
                })
              )
          },

          nextStep: {
            finalScore:
              null,

            recommendation:
              null,

            reason:
              "Validate and cache the weekly RB snapshot before reconnecting individual player scoring."
          }
        };

  return snapshot;
}

exports.buildRbSnapshot =
  buildRbSnapshot;

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

    if (
      !process.env
        .TANK01_API_KEY
    ) {
      return jsonResponse(
        500,
        {
          error:
            "TANK01_API_KEY is not configured."
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
      );

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

    const cacheKey =
      [
        season,
        targetWeek,
        seasonType
      ].join("|");

    const cached =
      memoryCache.get(
        cacheKey
      );

    if (
      cached &&
      (
        Date.now() -
        cached.createdAt
      ) <
      MEMORY_CACHE_TTL_MS
    ) {
      return jsonResponse(
        200,
        {
          ...cached.data,

          cache: {
            source:
              "warm_function_memory",

            snapshotKey:
              cacheKey
          }
        },

        CACHE_CONTROL
      );
    }

    try {
      const baseUrl =
        getBaseUrl(event);

      const snapshot =
        await buildRbSnapshot({
          baseUrl,
          season,
          targetWeek,
          seasonType
        });

      memoryCache.set(
        cacheKey,
        {
          createdAt:
            Date.now(),

          data:
            snapshot
        }
      );

      return jsonResponse(
        200,
        {
          ...snapshot,

          cache: {
            source:
              "fresh_build",

            snapshotKey:
              cacheKey
          }
        },

        CACHE_CONTROL
      );
    } catch (error) {
      console.error(
        "weekly-sage-rb-snapshot failed:",
        error
      );

      return jsonResponse(
        502,
        {
          error:
            "Could not build Weekly SAGE RB snapshot.",

          detail:
            error.message
        }
      );
    }
  };
