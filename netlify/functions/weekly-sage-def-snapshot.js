// netlify/functions/weekly-sage-def-snapshot.js
//
// WEEKLY SAGE — DEF/ST (TEAM DEFENSE) SNAPSHOT
//
// PURPOSE
// -------
// Build the season-to-date team defense evidence population and
// score for a target week, reading ONLY already-cached evidence --
// no Tank01 call of any kind happens in this file.
//
// Evidence source: the per-team defensive aggregates already written
// to each week's cached weekly-sage-defense Blob (see
// weekly-sage-defense-week.js, unmodified by this file, including
// its recently-deployed additive pointsAllowed field). Nothing here
// is fetched fresh -- this file only reads and combines what already
// exists across multiple weekly Blobs.
//
// IMPORTANT
// ---------
// This function DOES NOT:
// - call Tank01 in any way
// - route DEF through the QB/RB/WR/TE or K models -- this is a
//   DEF-specific model
// - use fumbles, defensive/special-teams touchdowns, safeties,
//   blocked kicks, or return touchdowns -- none of these fields have
//   been verified present in any cached evidence, so none are used
//   here (see the discovery report this implementation follows)
//
// MODEL (DEF-specific, documented weights)
// ------------------------------------------
//   Scoring prevention      45%  -- pointsAllowed.total /
//                                    pointsAllowed.gamesRepresented,
//                                    season-to-date, shrunk toward a
//                                    league-average prior by games
//                                    played
//   Defensive disruption    30%  -- (sacks + interceptions) per game,
//                                    season-to-date, similarly shrunk
//   Opponent environment    25%  -- the CURRENT WEEK's opponent's own
//                                    average offensive yards allowed
//                                    TO them by every defense they've
//                                    faced this season (a proxy for
//                                    "how potent is this week's
//                                    opponent offense"), also shrunk
//
// These weights are a documented, explainable starting point, not a
// live-calibrated constant -- scoring prevention is weighted highest
// because it is the single largest driver of real fantasy DEF/ST
// point totals, and no false precision (e.g. tenths of a percentage
// point) is claimed anywhere in this model.
//
// All three components are percentile-ranked against that week's own
// DEF/ST population (the same league-relative convention already
// used for K), then combined by the weights above.
//
// EVIDENCE WINDOW
// -----------------
// Season-to-date: Weeks 1 through targetWeek - 1, matching the
// existing no-look-ahead convention already used elsewhere in Weekly
// SAGE. A week's cached weekly-sage-defense Blob that is missing or
// incomplete is skipped entirely (not treated as a zero-evidence
// week) so a scheduling gap never silently understates a team's
// evidence.
//
// ═══════════════════════════════════════════════════════════════════════

const { getStore } = require("@netlify/blobs");

const DEFENSE_STORE = "weekly-sage-defense";

const WEIGHTS = {
  scoringPrevention: 0.45,
  disruption: 0.30,
  opponentEnvironment: 0.25
};

// Shrinkage priors. These are reasonable, generic NFL baseline rates
// used only to stabilize small samples -- not a live-calibrated
// league constant. Revisit once a full season of real 2026 data
// exists.
const POINTS_ALLOWED_PRIOR_PER_GAME = 22;
const DISRUPTION_PRIOR_PER_GAME = 2.5; // combined sacks + interceptions
const OPPONENT_YARDS_PRIOR_PER_GAME = 330;
const PRIOR_GAME_WEIGHT = 3;

function numOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function readDefenseWeek({ season, week, seasonType }) {
  const key = `week:${season}:${week}:${seasonType}`;

  try {
    const store = getStore({ name: DEFENSE_STORE });
    const cached = await store.get(key, { type: "json" });

    if (
      !cached ||
      cached.evidenceType !== "weekly-sage-defense-week" ||
      !cached.defenses ||
      typeof cached.defenses !== "object"
    ) {
      return null;
    }

    return cached.defenses;
  } catch (error) {
    return null;
  }
}

/*
  Shrinkage toward a games-weighted prior. Used identically for all
  three raw per-game rates below so one early-season game cannot
  produce an extreme value.
*/
function shrinkPerGame(total, games, priorPerGame) {
  return (total + priorPerGame * PRIOR_GAME_WEIGHT) / (games + PRIOR_GAME_WEIGHT);
}

/*
  Simple league-relative percentile: what fraction of the population
  this value is less-than-or-equal-to, expressed 0-100. Implemented
  locally rather than importing QB/RB/WR/TE/K machinery, matching the
  same "do not route through another position's model" discipline
  already applied to K.
*/
function percentileRank(value, population) {
  if (!population.length) return 50;

  const countAtOrBelow = population.filter(function (v) {
    return v <= value;
  }).length;

  return Math.round((countAtOrBelow / population.length) * 100);
}

function confidenceLabel(gamesRepresented) {
  if (gamesRepresented >= 5) return "Full";
  if (gamesRepresented >= 3) return "High";
  if (gamesRepresented >= 2) return "Moderate";
  if (gamesRepresented >= 1) return "Limited";
  return "Insufficient";
}

async function buildDefSnapshot({ season, targetWeek, seasonType }) {
  const normalizedSeason = String(season || new Date().getFullYear());
  const normalizedWeek = Number(targetWeek);
  const normalizedSeasonType = String(seasonType || "reg");

  if (!Number.isInteger(normalizedWeek) || normalizedWeek < 2 || normalizedWeek > 18) {
    throw new Error("targetWeek must be an integer from 2 through 18.");
  }

  const weeksInWindow = [];
  for (let week = 1; week < normalizedWeek; week += 1) {
    weeksInWindow.push(week);
  }

  const weeklyDefensesList = await Promise.all(
    weeksInWindow.map((week) =>
      readDefenseWeek({ season: normalizedSeason, week, seasonType: normalizedSeasonType })
    )
  );

  // Aggregate per-team evidence across the whole window. Each weekly
  // Blob's defenses.<TEAM>.pointsAllowed / passDefense.sacks /
  // passDefense.interceptions are ONE WEEK's values (0 or 1 game),
  // not season-cumulative -- this is where the season-to-date totals
  // are actually built, exactly matching how kickerEvidence is
  // aggregated across weeks in weekly-sage-k-snapshot.js.
  const aggregated = {};

  // Also reconstructs each team's OWN offensive output (yards gained
  // as an offense) from what every OTHER team's defense recorded
  // facing them -- see gamesUsed[].opponent / opponentTotalYards,
  // fields already confirmed present and populated in
  // weekly-sage-defense-week.js. This is the "opponent environment"
  // evidence source: it uses only already-cached, already-verified
  // fields, cross-referenced by opponent identity.
  const offenseYardsByTeam = {};

  weeklyDefensesList.forEach(function (weekDefenses) {
    if (!weekDefenses) return;

    Object.keys(weekDefenses).forEach(function (team) {
      const weekEntry = weekDefenses[team];
      if (!weekEntry) return;

      if (!aggregated[team]) {
        aggregated[team] = {
          team,
          gamesPlayed: 0,
          sacks: 0,
          interceptions: 0,
          pointsAllowedTotal: 0,
          pointsAllowedGames: 0
        };
      }

      const agg = aggregated[team];

      agg.gamesPlayed += numOrZero(weekEntry.games);
      agg.sacks += numOrZero(weekEntry.passDefense && weekEntry.passDefense.sacks);
      agg.interceptions += numOrZero(weekEntry.passDefense && weekEntry.passDefense.interceptions);
      agg.pointsAllowedTotal += numOrZero(weekEntry.pointsAllowed && weekEntry.pointsAllowed.total);
      agg.pointsAllowedGames += numOrZero(weekEntry.pointsAllowed && weekEntry.pointsAllowed.gamesRepresented);

      const gamesUsed = Array.isArray(weekEntry.gamesUsed) ? weekEntry.gamesUsed : [];
      gamesUsed.forEach(function (game) {
        const opponent = game && game.opponent;
        if (!opponent) return;

        if (!offenseYardsByTeam[opponent]) {
          offenseYardsByTeam[opponent] = { totalYards: 0, games: 0 };
        }

        offenseYardsByTeam[opponent].totalYards += numOrZero(game.opponentTotalYards);
        offenseYardsByTeam[opponent].games += 1;
      });
    });
  });

  const teams = Object.keys(aggregated);

  // Raw, shrunk per-game rates -- computed once per team so the
  // population arrays below and each team's own record use the
  // identical shrunk value.
  const shrunkByTeam = {};

  teams.forEach(function (team) {
    const agg = aggregated[team];

    const pointsAllowedPerGame = shrinkPerGame(
      agg.pointsAllowedTotal,
      agg.pointsAllowedGames,
      POINTS_ALLOWED_PRIOR_PER_GAME
    );

    const disruptionPerGame = shrinkPerGame(
      agg.sacks + agg.interceptions,
      agg.gamesPlayed,
      DISRUPTION_PRIOR_PER_GAME
    );

    const offenseEntry = offenseYardsByTeam[team];
    const ownOffenseYardsPerGame = offenseEntry && offenseEntry.games
      ? shrinkPerGame(offenseEntry.totalYards, offenseEntry.games, OPPONENT_YARDS_PRIOR_PER_GAME)
      : OPPONENT_YARDS_PRIOR_PER_GAME;

    shrunkByTeam[team] = {
      pointsAllowedPerGame,
      disruptionPerGame,
      ownOffenseYardsPerGame
    };
  });

  // Population arrays for percentile ranking.
  const pointsAllowedValues = teams.map((t) => shrunkByTeam[t].pointsAllowedPerGame);
  const disruptionValues = teams.map((t) => shrunkByTeam[t].disruptionPerGame);
  // Opponent-environment percentile is ranked against the full
  // league's offensive yards/game distribution (every team, since
  // any team could be a Week-N opponent), not just teams that
  // happen to also be DEF candidates this window.
  const allOffenseYardsValues = Object.keys(offenseYardsByTeam)
    .filter((t) => offenseYardsByTeam[t].games > 0)
    .map((t) => shrinkPerGame(offenseYardsByTeam[t].totalYards, offenseYardsByTeam[t].games, OPPONENT_YARDS_PRIOR_PER_GAME));

  const population = teams.map(function (team) {
    const agg = aggregated[team];
    const shrunk = shrunkByTeam[team];

    // Scoring prevention: FEWER points allowed is better, so invert
    // the percentile (a team allowing the fewest points should score
    // near 100, not near 0).
    const scoringPreventionPct = 100 - percentileRank(shrunk.pointsAllowedPerGame, pointsAllowedValues);
    const disruptionPct = percentileRank(shrunk.disruptionPerGame, disruptionValues);

    return {
      team,
      position: "DEF",
      gamesPlayed: agg.gamesPlayed,
      sacks: agg.sacks,
      interceptions: agg.interceptions,
      pointsAllowedTotal: agg.pointsAllowedTotal,
      pointsAllowedGamesRepresented: agg.pointsAllowedGames,
      pointsAllowedPerGame: Math.round(shrunk.pointsAllowedPerGame * 10) / 10,
      disruptionPerGame: Math.round(shrunk.disruptionPerGame * 10) / 10,
      ownOffenseYardsPerGame: Math.round(shrunk.ownOffenseYardsPerGame),
      components: {
        scoringPrevention: { percentile: scoringPreventionPct },
        disruption: { percentile: disruptionPct }
        // opponentEnvironment is intentionally NOT computed here --
        // it depends on the CURRENT WEEK's specific opponent, which
        // this season-to-date snapshot has no knowledge of. The
        // leaderboard resolves the opponent (via the schedule Blob)
        // and looks up that opponent's ownOffenseYardsPerGame value
        // from this same population at request time.
      },
      sageConfidenceLabel: confidenceLabel(agg.pointsAllowedGames)
    };
  });

  return {
    evidenceType: "weekly-sage-def-snapshot",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    season: normalizedSeason,
    targetWeek: normalizedWeek,
    seasonType: normalizedSeasonType,
    noLookAhead: {
      rule: `Only Weeks 1 through ${normalizedWeek - 1} are eligible.`,
      weeksQueried: weeksInWindow,
      targetWeekExcluded: true
    },
    methodology: {
      position: "DEF",
      philosophy: "Scoring prevention 45% / Defensive disruption 30% / Opponent environment 25%.",
      important: "This is a DEF-specific model. It does not use QB/RB/WR/TE or K methodology, and does not use fumbles, defensive/special-teams touchdowns, safeties, blocked kicks, or return touchdowns -- none of these fields are verified present in cached evidence.",
      shrinkage: `Points allowed, disruption, and opponent offensive yardage are each shrunk toward a league-average prior, weighted by ${PRIOR_GAME_WEIGHT} games, so a single early-season game cannot produce an extreme ranking.`,
      opponentEnvironmentNote: "Computed at leaderboard build time from this same population's ownOffenseYardsPerGame, resolved against the current week's actual opponent."
    },
    weights: WEIGHTS,
    population,
    allOffenseYardsValues,
    populationSummary: {
      weeksScanned: weeksInWindow.length,
      weeksWithEvidence: weeklyDefensesList.filter(Boolean).length,
      teamsDiscovered: population.length
    }
  };
}

exports.buildDefSnapshot = buildDefSnapshot;
