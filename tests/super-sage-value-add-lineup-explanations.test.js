"use strict";
const fs=require("fs");
const assert=require("assert");
const mcp=fs.readFileSync("netlify/functions/chatgpt-mcp.js","utf8");
const weekly=fs.readFileSync("netlify/functions/weekly-sage-rankings.js","utf8");

assert(mcp.includes("function buildComparativeLineupReason"),"comparative lineup reason builder missing");
assert(mcp.includes("material state change"),"material state-change explanation missing");
assert(mcp.includes("recent opportunities per game"),"initial explanation must expose opportunity evidence");
assert(mcp.includes("SAGE confidence"),"initial explanation must expose confidence");
assert(weekly.includes("QB_AVAILABILITY_CHANGE"),"QB availability propagation missing");
assert(weekly.includes("changed quarterback environment"),"affected skill-player state-change note missing");
assert(weekly.includes("does not assign an unverified numerical penalty"),"fail-closed QB effect guardrail missing");
assert(weekly.includes("for(const pos of ['WR','TE','RB'])"),"QB impact must propagate to WR/TE/RB");
console.log("Super SAGE value-add lineup explanation contract: PASS");
