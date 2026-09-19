const assert = require("assert");

const {
  applyEarlySeasonBaseline
} = require(
  "../netlify/functions/weekly-sage-rb-leaderboard"
);

function player(index) {
  return {
    playerID: String(index),
    name:
      index === 21
        ? "Saquon Barkley"
        : `RB ${index}`,
    sage: {
      score: 100 - index,
      confidence: 0.385
    }
  };
}

const leaderboard = Array.from(
  { length: 30 },
  (_, index) => player(index + 1)
);

const baselineOrder = [
  1, 2, 3, 4, 21,
  5, 6, 7, 8, 9,
  10, 11, 12, 13, 14,
  15, 16, 17, 18, 19,
  20, 22, 23, 24, 25,
  26, 27, 28, 29, 30
];

const adpSnapshot = {
  evidenceType: "tank01-adp-snapshot",
  players: baselineOrder.map(
    (id, index) => ({
      playerID: String(id),
      name:
        id === 21
          ? "Saquon Barkley"
          : `RB ${id}`,
      position: "RB",
      adp: index + 1
    })
  )
};

const result = applyEarlySeasonBaseline({
  leaderboard,
  adpSnapshot,
  week: 2,
  scoring: "half"
});

assert.strictEqual(result.applied, true);
assert.strictEqual(result.baselineWeight, 0.90);
assert.strictEqual(result.scoring, "half");

const ordered = leaderboard
  .slice()
  .sort(
    (a, b) =>
      b.sage.rankingScore -
      a.sage.rankingScore
  );

const barkleyRank = ordered.findIndex(
  item => item.name === "Saquon Barkley"
) + 1;

assert.ok(
  barkleyRank <= 10,
  `Expected elite baseline player inside top 10, received RB${barkleyRank}`
);

const weekFive = applyEarlySeasonBaseline({
  leaderboard: leaderboard.map(item => ({
    ...item,
    sage: { score: item.sage.score }
  })),
  adpSnapshot,
  week: 5,
  scoring: "half"
});

assert.strictEqual(
  weekFive.applied,
  false,
  "The preseason baseline must expire after Week 4."
);

console.log(
  "weekly-sage-rb-early-baseline.test.js passed"
);
