// Shared Weekly SAGE ranking QA guardrails.
//
// Competitor rankings are validation evidence only. They never enter the
// SAGE score or silently rewrite a leaderboard. This module identifies large,
// unexplained deviations for weekly review across every fantasy position.

const POSITIONS = Object.freeze(["QB", "RB", "WR", "TE", "K", "DEF"]);

const HARD_UNAVAILABLE = new Set([
  "OUT",
  "IR",
  "INACTIVE",
  "INJURED RESERVE",
  "RESERVE/INJURED",
  "SUSPENDED",
  "COMMISSIONER EXEMPT",
  "COMMISSIONER'S EXEMPT LIST",
  "COMMISSIONER_EXEMPT_NO_PLAY",
  "PUP",
  "RESERVE/PUP",
  "NFI",
  "RESERVE/NFI"
]);

const POLICY = Object.freeze({
  minimumBenchmarkSources: 2,
  comparisonLimit: 60,
  thresholds: Object.freeze([
    Object.freeze({ throughRank: 12, maximumDifference: 5 }),
    Object.freeze({ throughRank: 36, maximumDifference: 8 }),
    Object.freeze({ throughRank: 60, maximumDifference: 12 })
  ]),
  doubtfulReviewThroughRank: 36,
  mode: "weekly-qa-only",
  scoringImpact: "none"
});

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function numericRank(value) {
  const rank = Number(value);
  return Number.isInteger(rank) && rank > 0 ? rank : null;
}

function toleranceForRank(rank) {
  const value = numericRank(rank);
  if (value === null || value > POLICY.comparisonLimit) return null;
  const band = POLICY.thresholds.find(item => value <= item.throughRank);
  return band ? band.maximumDifference : null;
}

function median(values) {
  const sorted = values
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function statusFrom(row, availabilityByName) {
  const name = normalizeName(row && (row.name || row.player));
  const mapped = availabilityByName && availabilityByName[name];
  return String(
    mapped ||
    (row && (row.injuryStatus || row.availabilityStatus || row.rosterStatus)) ||
    ""
  ).trim().toUpperCase();
}

function benchmarkMaps(benchmarks, position) {
  return (Array.isArray(benchmarks) ? benchmarks : [])
    .filter(item => item && Array.isArray(item.rankings))
    .map(item => {
      const ranks = new Map();
      item.rankings.forEach(row => {
        const rowPosition = String(row.position || position || "").toUpperCase();
        const rank = numericRank(row.rank);
        const name = normalizeName(row.name || row.player);
        if (rowPosition === position && rank !== null && name) ranks.set(name, rank);
      });
      return {
        source: String(item.source || "unknown"),
        scoring: item.scoring || null,
        completeThroughRank: numericRank(item.completeThroughRank),
        ranks
      };
    });
}

function evaluatePosition({
  position,
  sageRankings,
  benchmarks,
  availabilityByName = {}
}) {
  const normalizedPosition = String(position || "").toUpperCase();
  if (!POSITIONS.includes(normalizedPosition)) {
    throw new Error(`Unsupported position: ${position}`);
  }

  const sageRows = Array.isArray(sageRankings) ? sageRankings : [];
  const sources = benchmarkMaps(benchmarks, normalizedPosition);
  const sourceCoveragePassed = sources.length >= POLICY.minimumBenchmarkSources;
  const sageNames = new Set();
  const reviews = [];

  sageRows.forEach((row, index) => {
    const name = String(row.name || row.player || "").trim();
    const key = normalizeName(name);
    const sageRank = numericRank(row.rank) || index + 1;
    if (!key || sageRank > POLICY.comparisonLimit) return;
    sageNames.add(key);

    const sourceRanks = sources
      .map(source => ({ source: source.source, rank: source.ranks.get(key) }))
      .filter(item => item.rank !== undefined);
    const omittedByCompleteSources = sources
      .filter(source =>
        source.completeThroughRank !== null &&
        source.completeThroughRank >= sageRank &&
        !source.ranks.has(key)
      )
      .map(source => source.source);
    const consensusRank = median(sourceRanks.map(item => item.rank));
    const tolerance = toleranceForRank(sageRank);
    const difference = consensusRank === null ? null : sageRank - consensusRank;
    const availability = statusFrom(row, availabilityByName);
    const reasons = [];
    let severity = "pass";

    if (HARD_UNAVAILABLE.has(availability)) {
      severity = "critical";
      reasons.push(`Ranked player has unavailable status ${availability}.`);
    } else if (
      availability === "DOUBTFUL" &&
      sageRank <= POLICY.doubtfulReviewThroughRank
    ) {
      severity = "review";
      reasons.push("Doubtful player is ranked inside the weekly starter range.");
    }

    if (
      sourceRanks.length >= POLICY.minimumBenchmarkSources &&
      tolerance !== null &&
      Math.abs(difference) > tolerance
    ) {
      const deviationSeverity = Math.abs(difference) > tolerance * 2
        ? "critical"
        : "review";
      if (deviationSeverity === "critical" || severity === "pass") {
        severity = deviationSeverity;
      }
      reasons.push(
        `SAGE differs from the benchmark median by ${Math.abs(difference)} spots; allowed difference is ${tolerance}.`
      );
    }

    if (
      sourceRanks.length < POLICY.minimumBenchmarkSources &&
      omittedByCompleteSources.length >= POLICY.minimumBenchmarkSources
    ) {
      severity = "critical";
      reasons.push(
        `Player is omitted by ${omittedByCompleteSources.length} complete benchmark lists; availability or identity review is required.`
      );
    }

    if (severity !== "pass") {
      reviews.push({
        position: normalizedPosition,
        player: name,
        sageRank,
        consensusRank,
        difference,
        tolerance,
        availability: availability || null,
        sourceRanks,
        omittedByCompleteSources,
        severity,
        reasons
      });
    }
  });

  const benchmarkPlayers = new Map();
  sources.forEach(source => {
    source.ranks.forEach((rank, name) => {
      if (!benchmarkPlayers.has(name)) benchmarkPlayers.set(name, []);
      benchmarkPlayers.get(name).push({ source: source.source, rank });
    });
  });

  benchmarkPlayers.forEach((sourceRanks, key) => {
    if (sageNames.has(key) || sourceRanks.length < POLICY.minimumBenchmarkSources) return;
    const consensusRank = median(sourceRanks.map(item => item.rank));
    if (consensusRank === null || consensusRank > POLICY.comparisonLimit) return;
    reviews.push({
      position: normalizedPosition,
      player: key,
      sageRank: null,
      consensusRank,
      difference: null,
      tolerance: toleranceForRank(consensusRank),
      availability: null,
      sourceRanks,
      severity: consensusRank <= 12 ? "critical" : "review",
      reasons: ["Consensus top-60 player is missing from the SAGE top 60."]
    });
  });

  reviews.sort((a, b) => {
    const severity = { critical: 0, review: 1 };
    return (severity[a.severity] - severity[b.severity]) ||
      ((a.sageRank || 999) - (b.sageRank || 999));
  });

  return {
    position: normalizedPosition,
    policy: POLICY,
    sources: sources.map(item => ({ source: item.source, scoring: item.scoring })),
    sourceCoveragePassed,
    reviewedPlayers: Math.min(sageRows.length, POLICY.comparisonLimit),
    critical: reviews.filter(item => item.severity === "critical").length,
    review: reviews.filter(item => item.severity === "review").length,
    passed: sourceCoveragePassed && reviews.length === 0,
    outliers: reviews
  };
}

function evaluateAllPositions({ positions, benchmarks, availability = {} }) {
  const reports = {};
  POSITIONS.forEach(position => {
    reports[position] = evaluatePosition({
      position,
      sageRankings: positions && positions[position],
      benchmarks: benchmarks && benchmarks[position],
      availabilityByName: availability && availability[position]
    });
  });
  return {
    policy: POLICY,
    passed: POSITIONS.every(position => reports[position].passed),
    reports
  };
}

module.exports = {
  POSITIONS,
  POLICY,
  evaluatePosition,
  evaluateAllPositions,
  toleranceForRank,
  normalizeName
};
