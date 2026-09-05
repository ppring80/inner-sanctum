"use strict";

/**
 * Inner Sanctum
 * RB Defensive Difficulty — Preseason V1
 *
 * PURPOSE
 * -------
 * Build a simple, explainable preseason RB defensive difficulty board
 * for all 32 NFL teams.
 *
 * V1 FORMULA
 * ----------
 * 50% DEF market strength
 * 50% projected run-defense strength
 *
 * IMPORTANT
 * ---------
 * - ZERO Tank01 calls
 * - ZERO network calls
 * - ZERO historical reconstruction
 * - Pure calculation module
 * - Intended to consume the existing Draft Command Center DEF ADP board
 *
 * CUSTOMER-FACING DIRECTION
 * -------------------------
 * Defense difficulty:
 *   #1  = hardest defense for an RB matchup
 *   #32 = easiest defense for an RB matchup
 *
 * This module is intentionally preseason-only and validation-oriented.
 */

const MODEL_VERSION = "rb-defense-difficulty-v1";

const MARKET_WEIGHT = 0.5;
const RUN_DEFENSE_WEIGHT = 0.5;

const RUN_DEFENSE_SOURCE = Object.freeze({
  provider: "CBS Sports",
  season: 2026,
  metric: "projected rushing yards allowed",
  capturedAt: "2026-09-04",
  url:
    "https://www.cbssports.com/fantasy/football/stats/DST/2026/season/projections/nonppr/",
});

/**
 * 2026 projected run-defense rank.
 *
 * Direction:
 *   1  = strongest projected run defense
 *   32 = weakest projected run defense
 *
 * Ties use average ranks.
 */
const RUN_DEFENSE_RANK_2026 = Object.freeze({
  ARI: 24,
  ATL: 25,
  BAL: 1,
  BUF: 31,
  CAR: 22,
  CHI: 30,
  CIN: 29,
  CLE: 7,
  DAL: 28,
  DEN: 3.5,
  DET: 20,
  GB: 12.5,
  HOU: 10,
  IND: 9,
  JAX: 14,
  KC: 2,
  LAC: 21,
  LAR: 16,
  LV: 3.5,
  MIA: 26,
  MIN: 8,
  NE: 17,
  NO: 6,
  NYG: 32,
  NYJ: 15,
  PHI: 18,
  PIT: 12.5,
  SEA: 5,
  SF: 19,
  TB: 11,
  TEN: 23,
  WSH: 27,
});

const NFL_TEAMS = Object.freeze([
  "ARI",
  "ATL",
  "BAL",
  "BUF",
  "CAR",
  "CHI",
  "CIN",
  "CLE",
  "DAL",
  "DEN",
  "DET",
  "GB",
  "HOU",
  "IND",
  "JAX",
  "KC",
  "LAC",
  "LAR",
  "LV",
  "MIA",
  "MIN",
  "NE",
  "NO",
  "NYG",
  "NYJ",
  "PHI",
  "PIT",
  "SEA",
  "SF",
  "TB",
  "TEN",
  "WSH",
]);

const TEAM_ALIASES = Object.freeze({
  ARZ: "ARI",

  BLT: "BAL",

  CLV: "CLE",

  GNB: "GB",
  GBP: "GB",

  HST: "HOU",

  JAC: "JAX",

  KAN: "KC",

  LVR: "LV",
  OAK: "LV",

  NEP: "NE",

  NOR: "NO",

  RAM: "LAR",
  LA: "LAR",

  SFO: "SF",

  TBB: "TB",

  WAS: "WSH",

  SD: "LAC",
  STL: "LAR",
});

/**
 * Normalize team abbreviations to Inner Sanctum canonical codes.
 */
function normalizeTeam(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const team = String(value)
    .trim()
    .toUpperCase();

  if (!team) {
    return null;
  }

  return TEAM_ALIASES[team] || team;
}

/**
 * Return a finite number or null.
 */
function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Round to fixed decimal precision while returning a Number.
 */
function round(value, digits = 4) {
  const number = finiteNumber(value);

  if (number === null) {
    return null;
  }

  const factor = Math.pow(10, digits);

  return Math.round(number * factor) / factor;
}

/**
 * Assign ascending ranks with average-rank treatment for ties.
 *
 * Smaller values receive better ranks.
 *
 * Example:
 *   values: 10, 20, 20, 40
 *   ranks:  1,  2.5, 2.5, 4
 */
function averageRanks(rows, valueGetter) {
  const indexed = rows.map((row, index) => ({
    row,
    index,
    value: finiteNumber(valueGetter(row)),
  }));

  indexed.sort((a, b) => {
    if (a.value === null && b.value === null) {
      return a.index - b.index;
    }

    if (a.value === null) {
      return 1;
    }

    if (b.value === null) {
      return -1;
    }

    if (a.value !== b.value) {
      return a.value - b.value;
    }

    return a.index - b.index;
  });

  const rankByIndex = new Map();

  let position = 0;

  while (position < indexed.length) {
    const start = position;
    const value = indexed[position].value;

    while (
      position + 1 < indexed.length &&
      indexed[position + 1].value === value
    ) {
      position += 1;
    }

    const end = position;

    const firstRank = start + 1;
    const lastRank = end + 1;
    const averageRank = (firstRank + lastRank) / 2;

    for (let i = start; i <= end; i += 1) {
      rankByIndex.set(indexed[i].index, averageRank);
    }

    position += 1;
  }

  return rows.map((row, index) => ({
    row,
    rank: rankByIndex.get(index),
  }));
}

/**
 * Convert a 1..32 rank to a 0..1 strength score.
 *
 * Direction:
 *   rank 1  => 1.0 strongest
 *   rank 32 => 0.0 weakest
 */
function rankToStrength(rank, teamCount = 32) {
  const numericRank = finiteNumber(rank);
  const count = finiteNumber(teamCount);

  if (
    numericRank === null ||
    count === null ||
    count <= 1 ||
    numericRank < 1 ||
    numericRank > count
  ) {
    return null;
  }

  return round((count - numericRank) / (count - 1), 6);
}

/**
 * Customer-facing matchup outlook.
 *
 * Defense difficulty direction:
 *   #1 hardest
 *   #32 easiest
 *
 * Approximate thirds:
 *   1-10  Difficult
 *   11-22 Neutral
 *   23-32 Favorable
 */
function outlookFromDifficultyRank(rank) {
  const numericRank = finiteNumber(rank);

  if (numericRank === null) {
    return "Unknown";
  }

  if (numericRank <= 10) {
    return "Difficult";
  }

  if (numericRank <= 22) {
    return "Neutral";
  }

  return "Favorable";
}

/**
 * Build the 2026 preseason RB defensive difficulty board.
 *
 * Expected input:
 *
 * [
 *   {
 *     name: "Houston Texans",
 *     team: "HOU",
 *     adp: 153.8,
 *     pos: "DEF"
 *   },
 *   ...
 * ]
 *
 * The function expects exactly 32 unique DEF market rows.
 */
function buildRbDefenseDifficulty(defenses, options = {}) {
  const marketWeight =
    finiteNumber(options.marketWeight) === null
      ? MARKET_WEIGHT
      : finiteNumber(options.marketWeight);

  const runDefenseWeight =
    finiteNumber(options.runDefenseWeight) === null
      ? RUN_DEFENSE_WEIGHT
      : finiteNumber(options.runDefenseWeight);

  const weightTotal = marketWeight + runDefenseWeight;

  if (weightTotal <= 0) {
    return {
      evidenceType: "rb-defense-difficulty",
      modelVersion: MODEL_VERSION,
      available: false,
      trustedForProduction: false,
      status: "invalid-weights",
      reason: "RB defensive difficulty weights must total more than zero.",
      ratings: [],
    };
  }

  const rows = Array.isArray(defenses) ? defenses : [];

  /**
   * Normalize and deduplicate by team.
   *
   * Keep the first usable row for each team.
   */
  const byTeam = new Map();

  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }

    const team = normalizeTeam(
      row.team ||
        row.teamAbv ||
        row.teamAbbr ||
        row.abbreviation ||
        row.abv
    );

    const adp = finiteNumber(row.adp);

    if (!team || adp === null) {
      continue;
    }

    if (!NFL_TEAMS.includes(team)) {
      continue;
    }

    if (byTeam.has(team)) {
      continue;
    }

    byTeam.set(team, {
      name: row.name || row.playerName || row.teamName || team,
      team,
      adp,
      sourceRow: row,
    });
  }

  /**
   * Production validation:
   * require all 32 defenses.
   */
  const missingMarketTeams = NFL_TEAMS.filter(
    (team) => !byTeam.has(team)
  );

  const missingRunDefenseTeams = NFL_TEAMS.filter(
    (team) => finiteNumber(RUN_DEFENSE_RANK_2026[team]) === null
  );

  if (
    byTeam.size !== 32 ||
    missingMarketTeams.length > 0 ||
    missingRunDefenseTeams.length > 0
  ) {
    return {
      evidenceType: "rb-defense-difficulty",
      modelVersion: MODEL_VERSION,
      available: false,
      trustedForProduction: false,
      status: "incomplete-input",
      reason:
        "RB defensive difficulty requires complete 32-team DEF market and run-defense inputs.",
      diagnostics: {
        receivedRows: rows.length,
        uniqueMarketTeams: byTeam.size,
        missingMarketTeams,
        missingRunDefenseTeams,
      },
      ratings: [],
    };
  }

  const normalized = NFL_TEAMS.map((team) => byTeam.get(team));

  /**
   * Market rank:
   * lower ADP = stronger market perception = rank 1.
   */
  const marketRanked = averageRanks(
    normalized,
    (row) => row.adp
  );

  const marketRankByTeam = new Map();

  for (const item of marketRanked) {
    marketRankByTeam.set(item.row.team, item.rank);
  }

  /**
   * Build pre-final score rows.
   */
  const preliminary = normalized.map((row) => {
    const marketRank = marketRankByTeam.get(row.team);
    const runDefenseRank = RUN_DEFENSE_RANK_2026[row.team];

    const marketStrength = rankToStrength(marketRank, 32);
    const runDefenseStrength = rankToStrength(
      runDefenseRank,
      32
    );

    const weightedMarket =
      marketStrength * marketWeight;

    const weightedRunDefense =
      runDefenseStrength * runDefenseWeight;

    const difficultyScore =
      (weightedMarket + weightedRunDefense) /
      weightTotal;

    return {
      name: row.name,
      team: row.team,
      adp: row.adp,

      marketRank,
      marketStrength,

      runDefenseRank,
      runDefenseStrength,

      difficultyScore: round(difficultyScore, 6),
    };
  });

  /**
   * Final difficulty rank:
   * higher combined strength = harder RB defense.
   *
   * Use average ranks for ties.
   *
   * averageRanks() is ascending, so rank the negative score.
   */
  const finalRanked = averageRanks(
    preliminary,
    (row) => -row.difficultyScore
  );

  const ratings = finalRanked
    .map((item) => {
      const row = item.row;
      const difficultyRank = item.rank;

      return {
        team: row.team,
        name: row.name,

        difficultyRank,
        difficultyRankLabel:
          Number.isInteger(difficultyRank)
            ? String(difficultyRank)
            : String(round(difficultyRank, 2)),

        difficultyScore: row.difficultyScore,

        outlook:
          outlookFromDifficultyRank(difficultyRank),

        market: {
          adp: row.adp,
          rank: row.marketRank,
          strength: row.marketStrength,
        },

        runDefense: {
          rank: row.runDefenseRank,
          strength: row.runDefenseStrength,
        },
      };
    })
    .sort((a, b) => {
      if (a.difficultyRank !== b.difficultyRank) {
        return a.difficultyRank - b.difficultyRank;
      }

      return a.team.localeCompare(b.team);
    });

  return {
    evidenceType: "rb-defense-difficulty",
    modelVersion: MODEL_VERSION,

    available: true,

    /**
     * This is intentionally still false.
     *
     * The model is in preseason validation and should not yet be treated
     * as a production-trusted SAGE scoring input.
     */
    trustedForProduction: false,

    status: "preseason-v1-validation",

    season: 2026,

    direction: {
      defenseRank:
        "#1 = hardest RB matchup; #32 = easiest RB matchup",
      difficultyScore:
        "higher = harder RB matchup",
    },

    weights: {
      market: round(
        marketWeight / weightTotal,
        4
      ),
      runDefense: round(
        runDefenseWeight / weightTotal,
        4
      ),
    },

    sources: {
      market:
        "Draft Command Center DEF ADP board",
      runDefense: RUN_DEFENSE_SOURCE,
    },

    diagnostics: {
      inputRows: rows.length,
      uniqueTeams: byTeam.size,
      ratingCount: ratings.length,
    },

    ratings,
  };
}

module.exports = {
  MODEL_VERSION,
  MARKET_WEIGHT,
  RUN_DEFENSE_WEIGHT,
  RUN_DEFENSE_SOURCE,
  RUN_DEFENSE_RANK_2026,
  NFL_TEAMS,
  normalizeTeam,
  finiteNumber,
  round,
  averageRanks,
  rankToStrength,
  outlookFromDifficultyRank,
  buildRbDefenseDifficulty,
};
