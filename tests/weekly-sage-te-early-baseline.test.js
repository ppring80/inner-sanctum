const assert = require("assert");
const {
  applyEarlySeasonBaseline,
  normalizeScoring
} = require("../netlify/functions/weekly-sage-te-leaderboard.js");

assert.strictEqual(normalizeScoring("half-ppr"), "half");

const names = [
  "Trey McBride", "Colston Loveland", "Dalton Kincaid", "Tyler Warren",
  "Tucker Kraft", "Sam LaPorta", "Dallas Goedert", "Isaiah Likely",
  "Mark Andrews", "George Kittle", "Travis Kelce", "Juwan Johnson",
  "Harold Fannin Jr.", "Kyle Pitts Sr.", "Michael Mayer", "Dalton Schultz",
  "Hunter Henry", "Jake Ferguson", "Brenton Strange", "Pat Freiermuth"
];

const leaderboard = names.map((name, index) => ({
  playerID: String(index + 1),
  name,
  sageScore: 70 - index,
  sageConfidence: 0.5,
  role: { rawScore: 60 },
  matchup: { rawScore: 60 }
}));

// Reproduce the bad one-game ordering without allowing it to erase the baseline.
leaderboard.find(player => player.name === "Kyle Pitts Sr.").sageScore = 5;
leaderboard.find(player => player.name === "Jake Ferguson").sageScore = 10;
leaderboard.find(player => player.name === "Colston Loveland").sageScore = 15;

const adpSnapshot = {
  evidenceType: "tank01-adp-snapshot",
  players: names.map((name, index) => ({
    playerID: String(index + 1), name, position: "TE", adp: index + 1
  }))
};

const result = applyEarlySeasonBaseline({ leaderboard, adpSnapshot, week: 2, scoring: "half-ppr" });
assert.strictEqual(result.applied, true);
assert.strictEqual(result.baselineWeight, 0.9);
assert.strictEqual(result.scoring, "half");
assert.strictEqual(result.matched, names.length);

const loveland = leaderboard.find(player => player.name === "Colston Loveland");
const pitts = leaderboard.find(player => player.name === "Kyle Pitts Sr.");
assert.strictEqual(loveland.baseline.positionRank, 2);
assert.ok(loveland.rankingScore > pitts.rankingScore);

const weekFive = leaderboard.map(player => ({ ...player, baseline: undefined, rankingScore: undefined }));
assert.strictEqual(applyEarlySeasonBaseline({
  leaderboard: weekFive, adpSnapshot, week: 5, scoring: "half"
}).applied, false);

console.log("weekly-sage-te-early-baseline.test.js passed");
