// netlify/functions/weekly-sage-rb-validation.js
//
// WEEKLY SAGE — RB HISTORICAL VALIDATION
//
// PURPOSE
// -------
// Compare a player's PRE-GAME Weekly SAGE score against what
// actually happened in the target week.
//
// Example:
//
//   targetWeek = 5
//
//   Prediction:
//     Weekly SAGE Week 5 leaderboard
//     -> built only from evidence before Week 5
//
//   Outcome:
//     weekly-sage-player-season with targetWeek = 6
//     -> contains Weeks 1 through 5
//     -> extract ONLY the Week 5 source game
//
// This preserves the original SAGE prediction and uses the
// target-week result strictly as POST-GAME validation.
//
// IMPORTANT
// ---------
// This function does NOT:
// - change SAGE scores
// - change Role / Production / Matchup weights
// - change confidence
// - create START / FLEX / SIT thresholds
// - feed actual target-week results back into the prediction
//
// Fantasy outcomes are returned in:
//
//   Standard
//   Half-PPR
//   PPR
//
// Fumble penalties and league-specific bonuses are NOT included
// unless those statistics are available and explicitly modeled.
//
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_SEASON_TYPE = "reg";

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

const LEADERBOARD_FUNCTION =
  "weekly-sage-rb-leaderboard";

const PLAYER_SEASON_FUNCTION =
  "weekly-sage-player-season";

const SCHEDULE_FUNCTION =
  "weekly-sage-schedule";

function num(value) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : 0;
}

function nullableNum(value) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}

function round(value, digits = 2) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return null;
  }

  const factor =
    Math.pow(10, digits);

  return (
    Math.round(
      (n + Number.EPSILON) *
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

function buildUrl({
  baseUrl,
  functionName,
  params
}) {
  const query =
    new URLSearchParams(
      params
    ).toString();

  return (
    `${baseUrl}/.netlify/functions/${functionName}` +
    `?${query}`
  );
}

async function fetchJsonWithStatus(url) {
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

  return {
    ok:
      response.ok,

    status:
      response.status,

    data
  };
}

async function fetchJson(url) {
  const result =
    await fetchJsonWithStatus(
      url
    );

  if (!result.ok) {
    const detail =
      result.data &&
      (
        result.data.detail ||
        result.data.error
      )
        ? (
            result.data.detail ||
            result.data.error
          )
        : `HTTP ${result.status}`;

    throw new Error(detail);
  }

  return result.data;
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

async function fetchLeaderboard({
  baseUrl,
  season,
  week,
  seasonType
}) {
  const url =
    buildUrl({
      baseUrl,

      functionName:
        LEADERBOARD_FUNCTION,

      params: {
        season,
        week:
          String(week),
        seasonType
      }
    });

  const data =
    await fetchJson(url);

  if (
    !data ||
    data.evidenceType !==
      "weekly-sage-rb-leaderboard"
  ) {
    throw new Error(
      "Unexpected Weekly SAGE RB leaderboard schema."
    );
  }

  return data;
}

/*
  TARGET-WEEK SCHEDULE
  --------------------

  We use the schedule only for POST-GAME participation
  classification.

  If the player's historical team had a scheduled game but
  getNFLGamesForPlayer contains no target-week game for that
  player, we classify the player as Did Not Play.

  DNP players are NOT assigned zero fantasy points.
  They are excluded from validation correlations.
*/
async function fetchTargetWeekSchedule({
  baseUrl,
  season,
  targetWeek,
  seasonType
}) {
  const url =
    buildUrl({
      baseUrl,

      functionName:
        SCHEDULE_FUNCTION,

      params: {
        season,
        week:
          String(targetWeek),
        seasonType
      }
    });

  const data =
    await fetchJson(url);

  if (
    !data ||
    data.evidenceType !==
      "weekly-sage-schedule"
  ) {
    throw new Error(
      "Unexpected Weekly SAGE schedule schema."
    );
  }

  return data;
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

function findScheduleGameForTeam(
  schedule,
  team
) {
  const normalizedTeam =
    normalizeTeam(team);

  if (!normalizedTeam) {
    return null;
  }

  const games =
    schedule &&
    Array.isArray(
      schedule.games
    )
      ? schedule.games
      : [];

  return (
    games.find(
      game => {
        const away =
          normalizeTeam(
            game.away
          );

        const home =
          normalizeTeam(
            game.home
          );

        return (
          away ===
            normalizedTeam ||
          home ===
            normalizedTeam
        );
      }
    ) ||
    null
  );
}

function scheduleContextForTeam(
  scheduleGame,
  team
) {
  if (!scheduleGame) {
    return null;
  }

  const normalizedTeam =
    normalizeTeam(team);

  const away =
    normalizeTeam(
      scheduleGame.away
    );

  const home =
    normalizeTeam(
      scheduleGame.home
    );

  if (
    normalizedTeam === away
  ) {
    return {
      team:
        normalizedTeam,

      opponent:
        home || null,

      location:
        "away",

      gameID:
        scheduleGame.gameID ||
        null,

      gameDate:
        scheduleGame.gameDate ||
        null,

      gameStatus:
        scheduleGame.gameStatus ||
        null
    };
  }

  if (
    normalizedTeam === home
  ) {
    return {
      team:
        normalizedTeam,

      opponent:
        away || null,

      location:
        "home",

      gameID:
        scheduleGame.gameID ||
        null,

      gameDate:
        scheduleGame.gameDate ||
        null,

      gameStatus:
        scheduleGame.gameStatus ||
        null
    };
  }

  return null;
}

/*
  To observe the actual target-week game while preserving
  no-look-ahead in the prediction:

    Prediction targetWeek = 5

    Outcome request targetWeek = 6

  weekly-sage-player-season(targetWeek=6) contains games
  from Weeks 1 through 5.

  We then extract ONLY Week 5.
*/
async function fetchPlayerOutcomeSource({
  baseUrl,
  season,
  targetWeek,
  seasonType,
  playerID
}) {
  const outcomeEvidenceWeek =
    targetWeek + 1;

  const url =
    buildUrl({
      baseUrl,

      functionName:
        PLAYER_SEASON_FUNCTION,

      params: {
        season,
        week:
          String(
            outcomeEvidenceWeek
          ),
        seasonType,
        playerID
      }
    });

  const result =
    await fetchJsonWithStatus(
      url
    );

  if (!result.ok) {
    return {
      ok: false,

      status:
        result.status,

      data:
        result.data
    };
  }

  if (
    !result.data ||
    result.data.evidenceType !==
      "weekly-sage-player-season"
  ) {
    return {
      ok: false,

      status: 502,

      data: {
        error:
          "Unexpected player-season schema."
      }
    };
  }

  return {
    ok: true,

    status: 200,

    data:
      result.data
  };
}

function errorMessage(result) {
  if (!result) {
    return "Unknown outcome retrieval failure.";
  }

  const data =
    result.data || {};

  return (
    data.detail ||
    data.error ||
    `HTTP ${result.status}`
  );
}

function gameWeek(game) {
  if (
    !game ||
    typeof game !== "object"
  ) {
    return null;
  }

  const value =
    game.week ??
    game.gameWeek ??
    game.weekNumber;

  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}

function findTargetGame(
  playerSeason,
  targetWeek
) {
  const games =
    Array.isArray(
      playerSeason.sourceGames
    )
      ? playerSeason.sourceGames
      : [];

  return (
    games.find(
      game =>
        gameWeek(game) ===
        targetWeek
    ) ||
    null
  );
}

function statBlock(
  game,
  ...names
) {
  if (
    !game ||
    typeof game !== "object"
  ) {
    return {};
  }

  for (const name of names) {
    if (
      game[name] &&
      typeof game[name] ===
        "object"
    ) {
      return game[name];
    }
  }

  return {};
}

function actualStats(game) {
  const passing =
    statBlock(
      game,
      "Passing",
      "passing"
    );

  const rushing =
    statBlock(
      game,
      "Rushing",
      "rushing"
    );

  const receiving =
    statBlock(
      game,
      "Receiving",
      "receiving"
    );

  const passYards =
    num(
      passing.passYds ??
      passing.passingYards ??
      passing.yards
    );

  const passTD =
    num(
      passing.passTD ??
      passing.passingTD ??
      passing.touchdowns
    );

  const interceptions =
    num(
      passing.int ??
      passing.interceptions ??
      passing.passInt
    );

  const carries =
    num(
      rushing.carries ??
      rushing.rushAttempts ??
      rushing.attempts
    );

  const rushYards =
    num(
      rushing.rushYds ??
      rushing.rushingYards ??
      rushing.yards
    );

  const rushTD =
    num(
      rushing.rushTD ??
      rushing.rushingTD ??
      rushing.touchdowns
    );

  const targets =
    num(
      receiving.targets ??
      receiving.recTargets
    );

  const receptions =
    num(
      receiving.receptions ??
      receiving.rec ??
      receiving.catches
    );

  const recYards =
    num(
      receiving.recYds ??
      receiving.receivingYards ??
      receiving.yards
    );

  const recTD =
    num(
      receiving.recTD ??
      receiving.receivingTD ??
      receiving.touchdowns
    );

  return {
    passing: {
      yards:
        passYards,

      touchdowns:
        passTD,

      interceptions
    },

    rushing: {
      carries,

      yards:
        rushYards,

      touchdowns:
        rushTD
    },

    receiving: {
      targets,

      receptions,

      yards:
        recYards,

      touchdowns:
        recTD
    },

    scrimmage: {
      touches:
        carries +
        receptions,

      opportunities:
        carries +
        targets,

      yards:
        rushYards +
        recYards,

      touchdowns:
        rushTD +
        recTD
    }
  };
}

/*
  Generic fantasy scoring used only for validation.

  Standard:
    Passing yards       0.04
    Passing TD          4
    INT                -2
    Rushing yards       0.10
    Rushing TD          6
    Receiving yards     0.10
    Receiving TD        6
    Reception           0

  Half-PPR:
    Same + 0.5 per reception

  PPR:
    Same + 1.0 per reception

  Fumbles and league-specific bonuses are intentionally
  excluded from this first validation layer.
*/
function fantasyPoints(stats) {
  const passingPoints =
    (
      stats.passing.yards *
      0.04
    ) +
    (
      stats.passing.touchdowns *
      4
    ) -
    (
      stats.passing.interceptions *
      2
    );

  const rushingPoints =
    (
      stats.rushing.yards *
      0.1
    ) +
    (
      stats.rushing.touchdowns *
      6
    );

  const receivingBase =
    (
      stats.receiving.yards *
      0.1
    ) +
    (
      stats.receiving.touchdowns *
      6
    );

  const base =
    passingPoints +
    rushingPoints +
    receivingBase;

  return {
    standard:
      round(
        base,
        2
      ),

    halfPPR:
      round(
        base +
        (
          stats.receiving.receptions *
          0.5
        ),
        2
      ),

    ppr:
      round(
        base +
        stats.receiving.receptions,
        2
      )
  };
}

function actualOutcome({
  game,
  player
}) {
  const stats =
    actualStats(game);

  const fantasy =
    fantasyPoints(stats);

  return {
    playerID:
      player.playerID,

    name:
      player.name,

    team:
      player.team,

    opponent:
      player.opponent,

    game: {
      gameID:
        game.gameID ||
        null,

      week:
        gameWeek(game),

      gameDate:
        game.gameDate ||
        null,

      gameStatus:
        game.gameStatus ||
        null
    },

    stats,

    fantasyPoints:
      fantasy
  };
}

function validationRecord({
  player,
  outcome
}) {
  return {
    playerID:
      player.playerID,

    name:
      player.name,

    team:
      player.team,

    opponent:
      player.opponent,

    sageRank:
      player.rank,

    sageScore:
      nullableNum(
        player.sage &&
        player.sage.score
      ),

    sageLabel:
      (
        player.sage &&
        player.sage.label
      ) ||
      null,

    sageConfidence:
      nullableNum(
        player.sage &&
        player.sage.confidence
      ),

    components: {
      role:
        nullableNum(
          player.role &&
          player.role.adjustedScore
        ),

      production:
        nullableNum(
          player.production &&
          player.production.adjustedScore
        ),

      matchup:
        nullableNum(
          player.matchup &&
          player.matchup.adjustedScore
        )
    },

    actual: {
      fantasyPoints:
        outcome.fantasyPoints,

      rushingYards:
        outcome.stats.rushing.yards,

      rushingTD:
        outcome.stats.rushing.touchdowns,

      receptions:
        outcome.stats.receiving.receptions,

      receivingYards:
        outcome.stats.receiving.yards,

      receivingTD:
        outcome.stats.receiving.touchdowns,

      scrimmageYards:
        outcome.stats.scrimmage.yards,

      touches:
        outcome.stats.scrimmage.touches,

      opportunities:
        outcome.stats.scrimmage.opportunities,

      totalTD:
        outcome.stats.scrimmage.touchdowns
    },

    targetGame:
      outcome.game
  };
}

function rankActual(
  records,
  scoringKey
) {
  const sorted =
    [...records].sort(
      (a, b) => {
        const aPoints =
          nullableNum(
            a.actual &&
            a.actual.fantasyPoints &&
            a.actual.fantasyPoints[
              scoringKey
            ]
          );

        const bPoints =
          nullableNum(
            b.actual &&
            b.actual.fantasyPoints &&
            b.actual.fantasyPoints[
              scoringKey
            ]
          );

        if (
          aPoints === null &&
          bPoints === null
        ) {
          return 0;
        }

        if (aPoints === null) {
          return 1;
        }

        if (bPoints === null) {
          return -1;
        }

        return (
          bPoints -
          aPoints
        );
      }
    );

  const ranks =
    new Map();

  sorted.forEach(
    (
      player,
      index
    ) => {
      ranks.set(
        player.playerID,
        index + 1
      );
    }
  );

  return ranks;
}

/*
  Pearson correlation.

  This answers:

    As SAGE score rises,
    do actual fantasy points tend to rise too?

  Range:
    +1 = perfect positive relationship
     0 = no linear relationship
    -1 = inverse relationship
*/
function pearsonCorrelation(
  records,
  scoringKey
) {
  const pairs =
    records
      .map(
        record => ({
          x:
            nullableNum(
              record.sageScore
            ),

          y:
            nullableNum(
              record.actual &&
              record.actual.fantasyPoints &&
              record.actual.fantasyPoints[
                scoringKey
              ]
            )
        })
      )
      .filter(
        pair =>
          pair.x !== null &&
          pair.y !== null
      );

  if (
    pairs.length < 2
  ) {
    return null;
  }

  const meanX =
    pairs.reduce(
      (sum, pair) =>
        sum + pair.x,
      0
    ) /
    pairs.length;

  const meanY =
    pairs.reduce(
      (sum, pair) =>
        sum + pair.y,
      0
    ) /
    pairs.length;

  let numerator = 0;
  let denominatorX = 0;
  let denominatorY = 0;

  for (const pair of pairs) {
    const dx =
      pair.x - meanX;

    const dy =
      pair.y - meanY;

    numerator +=
      dx * dy;

    denominatorX +=
      dx * dx;

    denominatorY +=
      dy * dy;
  }

  const denominator =
    Math.sqrt(
      denominatorX *
      denominatorY
    );

  if (
    denominator === 0
  ) {
    return null;
  }

  return round(
    numerator /
    denominator,
    3
  );
}

/*
  Spearman rank correlation.

  For fantasy rankings this is especially useful because we
  care whether SAGE generally orders players correctly, not
  merely whether score differences map linearly to point
  differences.

  This implementation uses average ranks for ties.
*/
function averageRanks(values) {
  const indexed =
    values.map(
      (
        value,
        index
      ) => ({
        value,
        index
      })
    );

  indexed.sort(
    (a, b) =>
      a.value - b.value
  );

  const ranks =
    new Array(
      values.length
    );

  let i = 0;

  while (
    i < indexed.length
  ) {
    let j =
      i + 1;

    while (
      j < indexed.length &&
      indexed[j].value ===
        indexed[i].value
    ) {
      j++;
    }

    /*
      Ranks are 1-based.

      If positions 2,3,4 are tied:
      average rank = 3.
    */
    const averageRank =
      (
        (i + 1) +
        j
      ) / 2;

    for (
      let k = i;
      k < j;
      k++
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

function pearsonArrays(
  xs,
  ys
) {
  if (
    xs.length !== ys.length ||
    xs.length < 2
  ) {
    return null;
  }

  const meanX =
    xs.reduce(
      (sum, value) =>
        sum + value,
      0
    ) /
    xs.length;

  const meanY =
    ys.reduce(
      (sum, value) =>
        sum + value,
      0
    ) /
    ys.length;

  let numerator = 0;
  let denominatorX = 0;
  let denominatorY = 0;

  for (
    let i = 0;
    i < xs.length;
    i++
  ) {
    const dx =
      xs[i] - meanX;

    const dy =
      ys[i] - meanY;

    numerator +=
      dx * dy;

    denominatorX +=
      dx * dx;

    denominatorY +=
      dy * dy;
  }

  const denominator =
    Math.sqrt(
      denominatorX *
      denominatorY
    );

  if (
    denominator === 0
  ) {
    return null;
  }

  return (
    numerator /
    denominator
  );
}

function spearmanCorrelation(
  records,
  scoringKey
) {
  const pairs =
    records
      .map(
        record => ({
          sage:
            nullableNum(
              record.sageScore
            ),

          actual:
            nullableNum(
              record.actual &&
              record.actual.fantasyPoints &&
              record.actual.fantasyPoints[
                scoringKey
              ]
            )
        })
      )
      .filter(
        pair =>
          pair.sage !== null &&
          pair.actual !== null
      );

  if (
    pairs.length < 2
  ) {
    return null;
  }

  const sageValues =
    pairs.map(
      pair =>
        pair.sage
    );

  const actualValues =
    pairs.map(
      pair =>
        pair.actual
    );

  const sageRanks =
    averageRanks(
      sageValues
    );

  const actualRanks =
    averageRanks(
      actualValues
    );

  const correlation =
    pearsonArrays(
      sageRanks,
      actualRanks
    );

  return correlation === null
    ? null
    : round(
        correlation,
        3
      );
}

function averageFantasyPoints(
  records,
  scoringKey
) {
  const values =
    records
      .map(
        record =>
          nullableNum(
            record.actual &&
            record.actual.fantasyPoints &&
            record.actual.fantasyPoints[
              scoringKey
            ]
          )
      )
      .filter(
        value =>
          value !== null
      );

  if (
    values.length === 0
  ) {
    return null;
  }

  return round(
    values.reduce(
      (sum, value) =>
        sum + value,
      0
    ) /
    values.length,
    2
  );
}

function groupBySageBand(records) {
  const definitions = [
    {
      key:
        "70_plus",

      label:
        "70+",

      min:
        70,

      max:
        Infinity
    },

    {
      key:
        "60_to_69_9",

      label:
        "60-69.9",

      min:
        60,

      max:
        69.999999
    },

    {
      key:
        "50_to_59_9",

      label:
        "50-59.9",

      min:
        50,

      max:
        59.999999
    },

    {
      key:
        "40_to_49_9",

      label:
        "40-49.9",

      min:
        40,

      max:
        49.999999
    },

    {
      key:
        "below_40",

      label:
        "Below 40",

      min:
        -Infinity,

      max:
        39.999999
    }
  ];

  return definitions.map(
    definition => {
      const players =
        records.filter(
          record => {
            const score =
              nullableNum(
                record.sageScore
              );

            return (
              score !== null &&
              score >=
                definition.min &&
              score <=
                definition.max
            );
          }
        );

      return {
        key:
          definition.key,

        label:
          definition.label,

        count:
          players.length,

        averageSageScore:
          players.length
            ? round(
                players.reduce(
                  (
                    sum,
                    player
                  ) =>
                    sum +
                    player.sageScore,
                  0
                ) /
                players.length,
                1
              )
            : null,

        averageActualFantasyPoints: {
          standard:
            averageFantasyPoints(
              players,
              "standard"
            ),

          halfPPR:
            averageFantasyPoints(
              players,
              "halfPPR"
            ),

          ppr:
            averageFantasyPoints(
              players,
              "ppr"
            )
        }
      };
    }
  );
}

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
      event.queryStringParameters ||
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

    /*
      Week 18 cannot use targetWeek + 1 through the current
      player-season architecture.

      Our present validation set is Weeks 5-8, so that is not
      a problem.
    */
    if (
      !Number.isInteger(
        targetWeek
      ) ||
      targetWeek < 2 ||
      targetWeek > 17
    ) {
      return jsonResponse(
        400,
        {
          error:
            "week must be an integer from 2 through 17."
        }
      );
    }

    try {
      const baseUrl =
        getBaseUrl(event);

      /*
        STEP 1
        ------
        Get the PRE-GAME Weekly SAGE leaderboard AND the
        target-week schedule.

        The leaderboard is the prediction side.

        The target-week schedule is used only AFTER the prediction
        is frozen, for participation/DNP classification.
      */
      const [
        leaderboard,
        targetWeekSchedule
      ] =
        await Promise.all([
          fetchLeaderboard({
            baseUrl,
            season,
            week:
              targetWeek,
            seasonType
          }),

          fetchTargetWeekSchedule({
            baseUrl,
            season,
            targetWeek,
            seasonType
          })
        ]);

      const activePlayers =
        Array.isArray(
          leaderboard.leaderboard
        )
          ? leaderboard.leaderboard
          : [];

      if (
        activePlayers.length === 0
      ) {
        return jsonResponse(
          422,
          {
            error:
              "Weekly SAGE leaderboard contains no active RBs."
          }
        );
      }

      /*
        STEP 2
        ------
        Retrieve target-week outcomes.

        For targetWeek 5 we request player-season targetWeek 6,
        then extract ONLY Week 5.

        This is post-game validation data and never changes the
        original Week 5 SAGE prediction.
      */
      const outcomeResults =
        await Promise.all(
          activePlayers.map(
            player =>
              fetchPlayerOutcomeSource({
                baseUrl,
                season,
                targetWeek,
                seasonType,
                playerID:
                  player.playerID
              })
          )
        );

      const validation =
        [];

      const didNotPlay =
        [];

      const missingOutcomes =
        [];

      const failures =
        [];

      outcomeResults.forEach(
        (
          result,
          index
        ) => {
          const player =
            activePlayers[index];

          if (!result.ok) {
            failures.push({
              playerID:
                player.playerID,

              name:
                player.name,

              team:
                player.team,

              error:
                errorMessage(
                  result
                )
            });

            return;
          }

          const game =
            findTargetGame(
              result.data,
              targetWeek
            );

          /*
            PLAYER PLAYED
            -------------

            A target-week historical player-game exists.

            This player enters:
              - actual fantasy-point calculation
              - actual rankings
              - Pearson correlation
              - Spearman correlation
              - diagnostic SAGE score bands
          */
          if (game) {
            const outcome =
              actualOutcome({
                game,
                player
              });

            validation.push(
              validationRecord({
                player,
                outcome
              })
            );

            return;
          }

          /*
            NO TARGET-WEEK PLAYER-GAME RECORD
            ---------------------------------

            Do NOT:
              - assign zero fantasy points
              - automatically call this missing data
              - automatically call this DNP

            Instead, reconcile the player's HISTORICAL team from
            weekly-sage-player-season against the target-week
            schedule.

            weekly-sage-player-season schema v3 returns:

              player.team

            as the historical team entering the target week.

            That protects historical validation from current-team
            metadata changes.
          */
          const historicalTeam =
            normalizeTeam(
              result.data &&
              result.data.player &&
              result.data.player.team
            );

          const scheduledGame =
            findScheduleGameForTeam(
              targetWeekSchedule,
              historicalTeam
            );

          const scheduleContext =
            scheduleContextForTeam(
              scheduledGame,
              historicalTeam
            );

          /*
            DID NOT PLAY
            ------------

            Historical team definitely had a target-week game,
            but the player has no player-game record for that game.

            Therefore:
              - classify DNP
              - exclude from correlations
              - do NOT score as zero
          */
          if (scheduleContext) {
            didNotPlay.push({
              playerID:
                player.playerID,

              name:
                player.name,

              predictionTeam:
                player.team ||
                null,

              historicalTeam:
                historicalTeam ||
                null,

              status:
                "did_not_play",

              eligibleForOutcomeValidation:
                false,

              fantasyPoints:
                null,

              scheduledGame:
                scheduleContext,

              reason:
                `Historical team ${historicalTeam} had a Week ${targetWeek} game, but no player-game record exists for this player in the post-game evidence. Classified as Did Not Play and excluded from validation correlations.`
            });

            return;
          }

          /*
            TRUE UNRESOLVED OUTCOME
            -----------------------

            We have no target-week player-game record AND cannot
            reconcile the historical team to the target-week
            schedule.

            This remains a data-quality problem.

            We deliberately do NOT silently turn it into DNP.
          */
          missingOutcomes.push({
            playerID:
              player.playerID,

            name:
              player.name,

            predictionTeam:
              player.team ||
              null,

            historicalTeam:
              historicalTeam ||
              null,

            status:
              "unresolved",

            reason:
              `No Week ${targetWeek} player-game record was found, and the historical team could not be reconciled to the target-week schedule.`
          });
        }
      );

      /*
        STEP 3
        ------
        Add actual finish ranks for all three scoring systems.

        DNP and unresolved players are NOT in validation[] and
        therefore cannot affect these ranks.
      */
      const standardRanks =
        rankActual(
          validation,
          "standard"
        );

      const halfPPRRanks =
        rankActual(
          validation,
          "halfPPR"
        );

      const pprRanks =
        rankActual(
          validation,
          "ppr"
        );

      validation.forEach(
        record => {
          record.actualRank = {
            standard:
              standardRanks.get(
                record.playerID
              ) ||
              null,

            halfPPR:
              halfPPRRanks.get(
                record.playerID
              ) ||
              null,

            ppr:
              pprRanks.get(
                record.playerID
              ) ||
              null
          };
        }
      );

      /*
        Keep output ordered by the original SAGE ranking.

        This makes visual validation easy:
        SAGE #1, #2, #3...
        compared directly with actual finish.
      */
      validation.sort(
        (a, b) =>
          a.sageRank -
          b.sageRank
      );

      /*
        STEP 4
        ------
        Calculate predictive relationships.

        Pearson:
          SAGE score vs actual fantasy points

        Spearman:
          SAGE ordering vs actual ordering

        Only PLAYED players are included.
      */
      const correlations = {
        standard: {
          pearson:
            pearsonCorrelation(
              validation,
              "standard"
            ),

          spearman:
            spearmanCorrelation(
              validation,
              "standard"
            )
        },

        halfPPR: {
          pearson:
            pearsonCorrelation(
              validation,
              "halfPPR"
            ),

          spearman:
            spearmanCorrelation(
              validation,
              "halfPPR"
            )
        },

        ppr: {
          pearson:
            pearsonCorrelation(
              validation,
              "ppr"
            ),

          spearman:
            spearmanCorrelation(
              validation,
              "ppr"
            )
        }
      };

      /*
        These bands are diagnostic only.

        They are NOT recommendation thresholds.

        We simply want to observe whether higher SAGE bands
        produce higher actual fantasy output.

        Again, DNP players are excluded.
      */
      const scoreBands =
        groupBySageBand(
          validation
        );

      return jsonResponse(
        200,
        {
          evidenceType:
            "weekly-sage-rb-validation",

          schemaVersion:
            2,

          generatedAt:
            new Date()
              .toISOString(),

          season,

          targetWeek,

          seasonType,

          methodology: {
            prediction:
              `Weekly SAGE Week ${targetWeek} score generated using only evidence available before Week ${targetWeek}.`,

            outcome:
              `Actual Week ${targetWeek} game extracted from player-season evidence queried with targetWeek=${targetWeek + 1}.`,

            leakageProtection:
              "Target-week actual results are used only after the frozen SAGE prediction has been retrieved. Actual results do not alter Role, Production, Matchup, Confidence, or the final SAGE score.",

            participationHandling:
              "A player with no target-week player-game record is classified as Did Not Play only when the player's historical team is independently confirmed on the target-week schedule. DNP players are excluded from correlations and are never assigned zero fantasy points.",

            fantasyScoring: {
              standard: {
                passingYards:
                  0.04,

                passingTD:
                  4,

                interception:
                  -2,

                rushingYards:
                  0.1,

                rushingTD:
                  6,

                receivingYards:
                  0.1,

                receivingTD:
                  6,

                reception:
                  0
              },

              halfPPR: {
                reception:
                  0.5,

                otherwise:
                  "Same as Standard"
              },

              ppr: {
                reception:
                  1,

                otherwise:
                  "Same as Standard"
              }
            },

            exclusions: [
              "Fumble penalties",
              "League-specific yardage bonuses",
              "League-specific first-down scoring"
            ],

            important:
              "This endpoint validates SAGE against actual outcomes. Diagnostic score bands are not START / FLEX / SIT thresholds."
          },

          population: {
            sageActivePlayers:
              activePlayers.length,

            outcomesMatched:
              validation.length,

            didNotPlay:
              didNotPlay.length,

            missingOutcomes:
              missingOutcomes.length,

            failures:
              failures.length
          },

          correlations,

          scoreBands,

          validation,

          didNotPlay,

          missingOutcomes,

          failures,

          recommendationThresholds:
            null,

          nextStep: {
            ready:
              validation.length > 0 &&
              missingOutcomes.length === 0 &&
              failures.length === 0,

            reason:
              missingOutcomes.length === 0 &&
              failures.length === 0
                ? "Played RBs were validated, DNP players were excluded from outcome correlations, and no unresolved outcome-data problems remain."
                : "Resolve missing outcomes or true retrieval failures before expanding historical validation."
          },

          provenance: {
            prediction:
              "weekly-sage-rb-leaderboard",

            outcomeEvidence:
              "weekly-sage-player-season",

            participationSchedule:
              "weekly-sage-schedule",

            outcomeWeekExtraction:
              `Week ${targetWeek} source game only`
          }
        },

        CACHE_CONTROL
      );
    } catch (error) {
      console.error(
        "weekly-sage-rb-validation failed:",
        error
      );

      return jsonResponse(
        502,
        {
          error:
            "Could not validate Weekly SAGE RB scores against actual outcomes.",

          detail:
            error.message
        }
      );
    }
  };
