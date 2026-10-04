"use strict";

const assert = require("assert");
const fs = require("fs");
const { toMcpStartersFromRecord } = require("../netlify/functions/_super-sage-lineup-presenters.js");

const record = {
  evidenceType: "super-sage-lineup-decision",
  decisionId: "contract-test",
  slots: [{
    slotLabel: "W/R/T",
    eligiblePositions: ["RB", "WR", "TE"],
    starter: {
      name: "Test Player",
      position: "WR",
      team: "TST",
      baseline: { tier: "FLEX" },
      matchup: "Neutral",
      availability: { rosterStatus: "ACTIVE", injuryStatus: null }
    },
    comparator: null,
    decisionState: "DECIDED",
    hasValidatedEdge: true,
    confidence: { label: "Moderate" },
    explanation: { headline: "Start Test Player", why: ["Weekly SAGE standing."], materialFacts: [], whatCouldChange: [] }
  }],
  bench: [],
  unavailable: [],
  benchWatch: []
};

const [row] = toMcpStartersFromRecord(record);
for (const key of [
  "slotLabel", "eligiblePositions", "playerID", "player", "position", "team",
  "recommendation", "sageLabel", "matchup", "rosterStatus", "reason"
]) assert(Object.prototype.hasOwnProperty.call(row, key), `MCP starter row missing required key: ${key}`);

assert.strictEqual(row.slotLabel, "W/R/T");
assert.deepStrictEqual(row.eligiblePositions, ["RB", "WR", "TE"]);
assert.strictEqual(row.player, "Test Player");
assert.strictEqual(row.recommendation, "FLEX");

const mcp = fs.readFileSync("netlify/functions/chatgpt-mcp.js", "utf8");
assert(mcp.includes("superSage: z.record(z.any()).optional()"), "MCP output schema must admit shared Super SAGE detail");
assert(mcp.includes("materialBenchContext: z.array(z.any()).optional()"), "MCP output schema must admit material bench context");
assert(mcp.includes("playerID: null,\n                player: p.name"), "Super SAGE bench rows must preserve MCP playerID contract");
assert(mcp.includes("sageLabel: null,\n                rosterStatus:"), "Super SAGE bench rows must preserve MCP sageLabel contract");

console.log("Super SAGE MCP output contract: PASS");
