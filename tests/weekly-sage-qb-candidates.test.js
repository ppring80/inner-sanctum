"use strict";

const assert = require("assert");
const {
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
  ["1", "2", "3", "5"]
);
assert.strictEqual(candidates[0].teamAbv, "GB");
assert.strictEqual(candidates[3].teamAbv, "KC");
assert.strictEqual(
  candidates.some(player => player.playerID === "4"),
  false
);

console.log("Weekly SAGE QB candidate tests passed.");
