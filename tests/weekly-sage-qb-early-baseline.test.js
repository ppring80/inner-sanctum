const assert = require("assert");

const {
  applyEarlySeasonBaseline
} = require("../netlify/functions/weekly-sage-qb-leaderboard.js");

const names = [
  "Josh Allen", "Lamar Jackson", "Jalen Hurts", "Jayden Daniels",
  "Dak Prescott", "Brock Purdy", "Justin Herbert", "Drake Maye",
  "Joe Burrow", "Jaxson Dart", "Patrick Mahomes", "Matthew Stafford",
  "Caleb Williams", "Bo Nix", "Jordan Love", "Baker Mayfield"
];

const leaderboard = names.map((name, index) => ({
  playerID: String(index + 1),
  name,
  sageScore: name === "Bryce Young" ? 90 : 70 - index,
  sageConfidence: 0.51,
  role: { rawScore: name === "Josh Allen" ? 90 : 80 },
  matchup: { rawScore: name === "Josh Allen" ? 45 : 60 }
}));

// Put Caleb first in one-game evidence while the baseline remains stable.
leaderboard.find(player => player.name === "Caleb Williams").sageScore = 99;

const adpSnapshot = {
  evidenceType: "tank01-adp-snapshot",
  players: names.map((name, index) => ({
    playerID: String(index + 1), name, position: "QB", adp: index + 1
  }))
};

const result = applyEarlySeasonBaseline({
  leaderboard, adpSnapshot, week: 2, scoring: "half-ppr"
});
assert.strictEqual(result.applied, true);
assert.strictEqual(result.baselineWeight, 0.90);
assert.strictEqual(result.scoring, "half");

const allen = leaderboard.find(player => player.name === "Josh Allen");
assert.strictEqual(allen.baseline.positionRank, 1);
assert.strictEqual(allen.baseline.expectationRestraint.applied, true);

const caleb = leaderboard.find(player => player.name === "Caleb Williams");
assert.ok(
  caleb.rankingScore < allen.rankingScore,
  "One Week 1 result must not automatically erase the established QB baseline."
);

const weekFive = leaderboard.map(player => ({
  ...player,
  baseline: undefined,
  rankingScore: undefined
}));
assert.strictEqual(applyEarlySeasonBaseline({
  leaderboard: weekFive, adpSnapshot, week: 5, scoring: "half"
}).applied, false);

console.log("weekly-sage-qb-early-baseline.test.js passed");
