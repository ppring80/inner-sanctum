"use strict";

const assert = require("assert");
const {
  effectiveMinimumGames,
  eligibilityReason,
  extractDepthChartQbCandidates
} = require("../netlify/functions/weekly-sage-qb-snapshot.js");

const candidates = extractDepthChartQbCandidates({
  body: [
    {
      teamAbv: "GB",
      depthChart: {
        QB: [
          { playerID: "1", longName: "QB One" },
          { playerID: "2", longName: "QB Two" },
          { playerID: "3", longName: "QB Three" },
          { playerID: "4", longName: "QB Four" }
        ]
      }
    },
    {
      teamAbv: "KC",
      depthChart: {
        QB: [
          { playerID: "5", longName: "QB Five" },
          { playerID: "1", longName: "Duplicate QB" }
        ]
      }
    }
  ]
});

assert.deepStrictEqual(
  candidates.map(player => player.playerID),
  ["1", "2", "5"]
);
assert.strictEqual(candidates[0].teamAbv, "GB");
assert.strictEqual(candidates[2].teamAbv, "KC");
assert.strictEqual(
  candidates.some(player => ["3", "4"].includes(player.playerID)),
  false
);

assert.strictEqual(effectiveMinimumGames(2), 1);
assert.strictEqual(effectiveMinimumGames(3), 2);
assert.strictEqual(effectiveMinimumGames(10), 2);

const oneGameStarter = {
  gamesUsed: 1,
  role: { passAttemptsPerGame: 30 }
};
assert.strictEqual(eligibilityReason(oneGameStarter, effectiveMinimumGames(2)), null);
assert.strictEqual(
  eligibilityReason(oneGameStarter, effectiveMinimumGames(3)),
  "insufficient_games"
);

console.log("Weekly SAGE QB candidate tests passed.");
