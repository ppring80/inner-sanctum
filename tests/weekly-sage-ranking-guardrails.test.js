const assert = require("assert");

const {
  POSITIONS,
  POLICY,
  evaluatePosition,
  evaluateAllPositions,
  toleranceForRank
} = require("../netlify/functions/weekly-sage-ranking-guardrails");

assert.strictEqual(toleranceForRank(1), 5);
assert.strictEqual(toleranceForRank(12), 5);
assert.strictEqual(toleranceForRank(13), 8);
assert.strictEqual(toleranceForRank(36), 8);
assert.strictEqual(toleranceForRank(37), 12);
assert.strictEqual(toleranceForRank(60), 12);
assert.strictEqual(toleranceForRank(61), null);
assert.strictEqual(POLICY.scoringImpact, "none");

const benchmarks = [
  {
    source: "FantasyPros",
    scoring: "half",
    rankings: [
      { name: "Puka Nacua", position: "WR", rank: 1 },
      { name: "Devaughn Vele", position: "WR", rank: 47 },
      { name: "Nico Collins", position: "WR", rank: 56 }
    ]
  },
  {
    source: "ESPN",
    scoring: "ppr",
    rankings: [
      { name: "Puka Nacua", position: "WR", rank: 1 },
      { name: "Devaughn Vele", position: "WR", rank: 45 },
      { name: "Nico Collins", position: "WR", rank: 56 }
    ]
  },
  {
    source: "Yahoo",
    scoring: "ppr",
    rankings: [
      { name: "Puka Nacua", position: "WR", rank: 1 },
      { name: "Devaughn Vele", position: "WR", rank: 49 }
    ]
  }
];

const wrReport = evaluatePosition({
  position: "WR",
  sageRankings: [
    { name: "Puka Nacua", rank: 4 },
    { name: "Nico Collins", rank: 6, injuryStatus: "OUT" },
    { name: "Devaughn Vele", rank: 65 }
  ],
  benchmarks
});

assert.strictEqual(
  wrReport.outliers.some(item => item.player === "Puka Nacua"),
  false,
  "A four-vs-one difference remains inside the top-12 tolerance."
);
assert.strictEqual(
  wrReport.outliers.find(item => item.player === "Nico Collins").severity,
  "critical",
  "An OUT player ranked in the top 60 must be critical."
);
assert.ok(
  wrReport.outliers.some(item =>
    item.player === "devaughnvele" && item.sageRank === null
  ),
  "A consensus top-60 player missing from SAGE's top 60 must be reviewed."
);

const positionPayload = {};
const benchmarkPayload = {};
POSITIONS.forEach(position => {
  positionPayload[position] = [{ name: `${position} One`, position, rank: 1 }];
  benchmarkPayload[position] = [
    { source: "A", rankings: [{ name: `${position} One`, position, rank: 1 }] },
    { source: "B", rankings: [{ name: `${position} One`, position, rank: 2 }] }
  ];
});

const allPositions = evaluateAllPositions({
  positions: positionPayload,
  benchmarks: benchmarkPayload
});

assert.strictEqual(allPositions.passed, true);
assert.deepStrictEqual(Object.keys(allPositions.reports), POSITIONS);

const missingBenchmarkCoverage = evaluateAllPositions({
  positions: positionPayload,
  benchmarks: {
    ...benchmarkPayload,
    QB: benchmarkPayload.QB.slice(0, 1)
  }
});

assert.strictEqual(missingBenchmarkCoverage.passed, false);
assert.strictEqual(missingBenchmarkCoverage.reports.QB.sourceCoveragePassed, false);

console.log("weekly-sage-ranking-guardrails.test.js passed");
