"use strict";

const assert = require("assert");
const {
  extractDepthChartWrCandidates
} = require("../netlify/functions/weekly-sage-wr-snapshot.js");

const candidates = extractDepthChartWrCandidates({
  body: [
    {
      teamAbv: "GB",
      depthChart: {
        WR: [
          { playerID: "1", longName: "WR One" },
          { playerID: "2", longName: "WR Two" },
          { playerID: "3", longName: "WR Three" },
          { playerID: "4", longName: "WR Four" },
          { playerID: "5", longName: "WR Five" }
        ]
      }
    },
    {
      teamAbv: "KC",
      depthChart: {
        WR: [
          { playerID: "6", longName: "WR Six" },
          { playerID: "1", longName: "Duplicate WR" }
        ]
      }
    }
  ]
});

assert.deepStrictEqual(
  candidates.map(player => player.playerID),
  ["1", "2", "3", "4", "6"]
);
assert.strictEqual(candidates[0].teamAbv, "GB");
assert.strictEqual(candidates[4].teamAbv, "KC");
assert.strictEqual(candidates.some(player => player.playerID === "5"), false);

console.log("Weekly SAGE WR candidate tests passed.");
