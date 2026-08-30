// netlify/functions/weekly-sage-k-snapshot.js
//
// WEEKLY SAGE — K (PLACE KICKER) SNAPSHOT
//
// PURPOSE
// -------
// Build the season-to-date place-kicker evidence population and
// score for a target week, reading ONLY already-cached evidence --
// no Tank01 call of any kind happens in this file.
//
// Evidence source: the kickerEvidence array already written
// additively to each week's cached weekly-sage-defense Blob (see
// weekly-sage-defense-week.js, unmodified by this file). That
// evidence was produced from the exact same box-score calls the
// defense pipeline already makes -- nothing new is fetched here.
//
// IMPORTANT
// ---------
// This function DOES NOT:
// - call Tank01 in any way
// - route K through the QB/RB/WR/TE role/production/matchup model
// - identify a place kicker merely by the presence of a Kicking
//   object -- weekly-sage-defense-week.js already excludes return
//   specialists there (see isPlaceKickerStatLine in that file), and
//   this file adds a second, independent check: a playerID is only
//   included if the CURRENT player-data roster cache also lists
//   them at position K (PK normalized to K, matching the convention
//   already used in weekly-sage-week1-rankings.js)
// - invent any field not already present in kickerEvidence or
//   player-data
//
// MODEL PHILOSOPHY (K-specific, not QB/RB/WR/TE's model)
// ---------------------------------------------------------
//   Opportunity              40%  -- FG+XP attempts per game, season-to-date
//   Team scoring environment 25%  -- team points per game, rolling last 3
//   Reliability              20%  -- FG/XP conversion, shrunk toward a
//                                     neutral prior by attempt volume so a
//                                     1-for-1 kicker is not scored as
//                                     equivalent to an established one
//   Range                    15%  -- longest FG / 50+ makes, capped so a
//                                     single long attempt cannot dominate
//
// All four components are percentile-ranked against that week's own
// K population (the same "league-relative" convention already used
// elsewhere in Weekly SAGE), then combined by the weights above.
//
// EVIDENCE WINDOW
// ----------------
// Season-to-date: Weeks 1 through targetWeek - 1, matching the
// existing no-look-ahead convention. A week's cached
// weekly-sage-defense Blob that is missing or incomplete is skipped
// (not treated as zero attempts) so a scheduling gap does not
// silently reduce a kicker's opportunity data.
//
// ═══════════════════════════════════════════════════════════════════════

const { getStore } = require("@netlify/blobs");

const DEFENSE_STORE = "weekly-sage-defense";
const PLAYER_DATA_STORE = "player-data";
const PLAYER_DATA_KEY = "playerData";

const TEAM_SCORING_WINDOW = 3;

const WEIGHTS = {
  opportunity: 0.40,
  teamScoring: 0.25,
  reliability: 0.20,
  range: 0.15
};

// Reliability shrinkage prior. These are reasonable, generic NFL
// baseline rates used only to stabilize small samples -- not a
// live-calibrated league constant. Revisit once a full season of
// real 2026 data exists.
const FG_PRIOR_PCT = 0.85;
const XP_PRIOR_PCT = 0.95;
const PRIOR_ATTEMPT_WEIGHT = 10;

function normalizePosition(position) {
  const raw = String(position || "").trim().toUpperCase();
  return raw === "PK" ? "K" : raw;
}

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
      !Array.isArray(cached.kickerEvidence)
    ) {
      return null;
    }

    return cached.kickerEvidence;
  } catch (error) {
    return null;
  }
}

async function readPlayerData() {
  try {
    const store = getStore({ name: PLAYER_DATA_STORE });
    const cached = await store.get(PLAYER_DATA_KEY, { type: "json" });
    return cached && cached.players && typeof cached.players === "object"
      ? cached.players
      : {};
  } catch (error) {
    return {};
  }
}

/*
  Aggregate raw kickerEvidence entries (already read from cached
  weekly-sage-defense Blobs) into one record per playerID, across
  the whole evidence window.
*/
function aggregateKickerEvidence(weeklyEvidenceList) {
  const byPlayer = {};

  weeklyEvidenceList.forEach(function (weekEntries) {
    if (!Array.isArray(weekEntries)) return;

    weekEntries.forEach(function (entry) {
      if (!entry || !entry.playerID) return;

      if (!byPlayer[entry.playerID]) {
        byPlayer[entry.playerID] = {
          playerID: entry.playerID,
          name: entry.name || null,
          historicalTeam: entry.team || null,
          gamesPlayed: 0,
          fgAttempts: 0,
          fgMade: 0,
          fgMissed: 0,
          xpAttempts: 0,
          xpMade: 0,
          xpMissed: 0,
          fgLong: 0,
          madeFgDistances: [],
          teamPointsRecent: []
        };
      }

      const agg = byPlayer[entry.playerID];

      agg.gamesPlayed += 1;
      agg.fgAttempts += numOrZero(entry.fgAttempts);
      agg.fgMade += numOrZero(entry.fgMade);
      agg.fgMissed += numOrZero(entry.fgMissed);
      agg.xpAttempts += numOrZero(entry.xpAttempts);
      agg.xpMade += numOrZero(entry.xpMade);
      agg.xpMissed += numOrZero(entry.xpMissed);
      agg.fgLong = Math.max(agg.fgLong, numOrZero(entry.fgLong));

      if (Array.isArray(entry.madeFgDistances)) {
        agg.madeFgDistances = agg.madeFgDistances.concat(entry.madeFgDistances);
      }

      // Team scoring context: this kicker's own team's points in
      // this specific game, from homePts/awayPts already on the
      // same evidence record -- no new field, no new call.
      const isHome = entry.team === entry.home;
      const isAway = entry.team === entry.away;
      const teamPts = isHome
        ? numOrZero(entry.homePts)
        : (isAway ? numOrZero(entry.awayPts) : null);

      if (teamPts !== null) {
        agg.teamPointsRecent.push(teamPts);
      }

      // Most recent CURRENT team as recorded in the box score wins,
      // in case of an in-season team change -- this is later
      // reconciled against player-data's authoritative current team.
      agg.historicalTeam = entry.team || agg.historicalTeam;
    });
  });

  return byPlayer;
}

/*
  Simple league-relative percentile: what fraction of the population
  this value is greater than or equal to, expressed 0-100. Matches
  the "league-relative percentile" convention already used elsewhere
  in Weekly SAGE, implemented locally here rather than importing
  QB/RB/WR/TE machinery, per "do not route K through that model."
*/
function percentileRank(value, population) {
  if (!population.length) return 50;

  const countAtOrBelow = population.filter(function (v) {
    return v <= value;
  }).length;

  return Math.round((countAtOrBelow / population.length) * 100);
}

function shrunkPct(makes, attempts, priorPct) {
  return (makes + priorPct * PRIOR_ATTEMPT_WEIGHT) / (attempts + PRIOR_ATTEMPT_WEIGHT);
}

/*
  Range component: neutral baseline of 50, plus a capped bonus for
  the longest make and for 50+ yard makes. Deliberately bounded so a
  single long attempt cannot dominate the composite score.
*/
function rangeScore(fgLong, madeFgDistances) {
  const longBonus =
    fgLong >= 55 ? 25 :
    fgLong >= 50 ? 15 :
    fgLong >= 45 ? 5 : 0;

  const fiftyPlusCount = madeFgDistances.filter(function (d) {
    return numOrZero(d) >= 50;
  }).length;

  const volumeBonus = Math.min(fiftyPlusCount * 5, 15);

  return Math.min(50 + longBonus + volumeBonus, 100);
}

function confidenceLabel(gamesPlayed, totalAttempts) {
  if (gamesPlayed >= 5 && totalAttempts >= 15) return "Full";
  if (gamesPlayed >= 3 && totalAttempts >= 8) return "High";
  if (gamesPlayed >= 2 && totalAttempts >= 4) return "Moderate";
  if (gamesPlayed >= 1) return "Limited";
  return "Insufficient";
}

async function buildKSnapshot({ season, targetWeek, seasonType }) {
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

  const [weeklyEvidenceList, playerData] = await Promise.all([
    Promise.all(
      weeksInWindow.map((week) =>
        readDefenseWeek({ season: normalizedSeason, week, seasonType: normalizedSeasonType })
      )
    ),
    readPlayerData()
  ]);

  const aggregated = aggregateKickerEvidence(weeklyEvidenceList);

  const candidates = Object.keys(aggregated)
    .map((playerID) => {
      const evidence = aggregated[playerID];
      const rosterEntry = playerData[playerID];

      // Authoritative current identity/team check -- a playerID is
      // only a K candidate if the CURRENT player-data roster cache
      // also lists them at position K. This is independent of, and
      // in addition to, weekly-sage-defense-week.js's own FG/XP
      // field presence check -- never gated on Kicking-object
      // presence alone.
      if (!rosterEntry || normalizePosition(rosterEntry.pos) !== "K") {
        return null;
      }

      return {
        playerID,
        name: rosterEntry.longName || evidence.name,
        team: rosterEntry.team || evidence.historicalTeam,
        evidence
      };
    })
    .filter(Boolean);

  // Population arrays for percentile ranking, computed once.
  const opportunityValues = candidates.map((c) => {
    const games = c.evidence.gamesPlayed || 1;
    return (c.evidence.fgAttempts + c.evidence.xpAttempts) / games;
  });

  const teamScoringValues = candidates.map((c) => {
    const recent = c.evidence.teamPointsRecent.slice(-TEAM_SCORING_WINDOW);
    if (!recent.length) return 0;
    return recent.reduce((sum, v) => sum + v, 0) / recent.length;
  });

  const reliabilityValues = candidates.map((c) => {
    const fgPct = shrunkPct(c.evidence.fgMade, c.evidence.fgAttempts, FG_PRIOR_PCT);
    const xpPct = shrunkPct(c.evidence.xpMade, c.evidence.xpAttempts, XP_PRIOR_PCT);
    return (fgPct + xpPct) / 2;
  });

  const population = candidates.map((c, index) => {
    const games = c.evidence.gamesPlayed || 1;
    const opportunityPerGame = (c.evidence.fgAttempts + c.evidence.xpAttempts) / games;
    const teamScoringPerGame = teamScoringValues[index];
    const reliabilityRaw = reliabilityValues[index];
    const totalAttempts = c.evidence.fgAttempts + c.evidence.xpAttempts;

    const opportunityPct = percentileRank(opportunityPerGame, opportunityValues);
    const teamScoringPct = percentileRank(teamScoringPerGame, teamScoringValues);
    const reliabilityPct = percentileRank(reliabilityRaw, reliabilityValues);
    const rangePct = rangeScore(c.evidence.fgLong, c.evidence.madeFgDistances);

    const compositeScore = Math.round(
      opportunityPct * WEIGHTS.opportunity +
      teamScoringPct * WEIGHTS.teamScoring +
      reliabilityPct * WEIGHTS.reliability +
      rangePct * WEIGHTS.range
    );

    return {
      playerID: c.playerID,
      name: c.name,
      team: c.team,
      position: "K",
      gamesPlayed: c.evidence.gamesPlayed,
      fgAttempts: c.evidence.fgAttempts,
      fgMade: c.evidence.fgMade,
      fgMissed: c.evidence.fgMissed,
      xpAttempts: c.evidence.xpAttempts,
      xpMade: c.evidence.xpMade,
      xpMissed: c.evidence.xpMissed,
      fgLong: c.evidence.fgLong,
      madeFgDistances: c.evidence.madeFgDistances,
      components: {
        opportunity: { perGame: Math.round(opportunityPerGame * 100) / 100, percentile: opportunityPct },
        teamScoring: { perGame: Math.round(teamScoringPerGame * 100) / 100, percentile: teamScoringPct },
        reliability: { pct: Math.round(reliabilityRaw * 1000) / 10, percentile: reliabilityPct },
        range: { percentile: rangePct }
      },
      sageScore: compositeScore,
      sageConfidenceLabel: confidenceLabel(c.evidence.gamesPlayed, totalAttempts)
    };
  });

  return {
    evidenceType: "weekly-sage-k-snapshot",
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
      position: "K",
      philosophy: "Opportunity 40% / Team scoring environment 25% / Reliability 20% / Range 15%.",
      important: "This is a K-specific model. It does not use QB/RB/WR/TE role/production/matchup methodology.",
      reliabilityShrinkage: `FG/XP conversion shrunk toward a ${Math.round(FG_PRIOR_PCT * 100)}%/${Math.round(XP_PRIOR_PCT * 100)}% prior, weighted by ${PRIOR_ATTEMPT_WEIGHT} attempts, so low-attempt kickers are not scored as equivalent to established ones.`,
      rangeCap: "Range contribution is capped so a single long attempt cannot dominate the composite score."
    },
    population,
    populationSummary: {
      weeksScanned: weeksInWindow.length,
      weeksWithEvidence: weeklyEvidenceList.filter(Boolean).length,
      candidatesDiscovered: Object.keys(aggregated).length,
      candidatesConfirmedAsK: population.length
    }
  };
}

exports.buildKSnapshot = buildKSnapshot;
