"use strict";

const assert = require("assert");
const {
  extractDepthChartRbCandidates
} = require("../netlify/functions/weekly-sage-rb-snapshot.js");

const candidates = extractDepthChartRbCandidates({
  body: [
    {
      teamAbv: "GB",
      depthChart: {
        RB: [
          { playerID: "1", longName: "RB One" },
          { playerID: "2", longName: "RB Two" },
          { playerID: "3", longName: "RB Three" },
          { playerID: "4", longName: "RB Four" },
          { playerID: "5", longName: "RB Five" }
        ]
      }
    },
    {
      teamAbv: "KC",
      depthChart: {
        RB: [
          { playerID: "6", longName: "RB Six" },
          { playerID: "1", longName: "Duplicate RB" }
        ]
      }
    }
  ]
});

assert.deepStrictEqual(
  candidates.map(player => player.playerID),
  ["1", "2", "3", "4", "6"]
);
assert.strictEqual(candidates[0].team, "GB");
assert.strictEqual(candidates[4].team, "KC");
assert.strictEqual(candidates.some(player => player.playerID === "5"), false);

console.log("Weekly SAGE RB candidate tests passed.");
