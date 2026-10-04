"use strict";
// Airtight state-change explanation contract.
//
// Weekly SAGE guardrails are unchanged. The lineup explanation contract now
// lives in the ONE shared Super SAGE authority (moved out of chatgpt-mcp.js's
// former local optimizer): MCP and the website must present material facts on
// starters AND on plausible legal alternatives in the initial output, and the
// initial explanation must name the decisive comparison.
const fs=require("fs"),assert=require("assert");
const weekly=fs.readFileSync("netlify/functions/weekly-sage-rankings.js","utf8");
const mcp=fs.readFileSync("netlify/functions/chatgpt-mcp.js","utf8");
assert(weekly.includes("Transactions are a second verified path"),"verified transaction fallback missing");
assert(weekly.includes("QB_AVAILABILITY_CHANGE"),"QB environment context missing");
assert(weekly.includes("for(const pos of ['WR','TE','RB'])"),"QB propagation scope missing");
assert(weekly.includes("does not assign an unverified numerical penalty"),"conservative-truth guardrail missing");
assert(mcp.includes("decideSharedLineup("),"MCP lineup must use the shared Super SAGE authority");
assert(mcp.includes("materialBenchContext: superSage && superSage.record ? superSage.record.benchWatch"),"material bench context must come from the shared record");

// Behaviour, not source strings: run the shared presenters on the frozen
// production Week 4 record.
const { run } = require("../scripts/run-super-sage-week4-acceptance.js");
const { toCustomerAnswer, toMcpStartersFromRecord } = require("../netlify/functions/_super-sage-lineup-presenters.js");
const record = run().record;
const answer = toCustomerAnswer(record);
// Material facts on legal alternatives (bench watch) reach the initial output.
record.benchWatch.forEach((w) => assert(answer.tenSeconds.some((l) => l.startsWith(`${w.player}:`)), `bench-watch material fact hidden: ${w.player}`));
// Material facts on starters reach the starter's initial reason.
const starters = toMcpStartersFromRecord(record);
record.slots.filter((s) => s.starter).forEach((s) => {
  const row = starters.find((r) => r.slot === s.slotLabel && r.player === s.starter.name);
  s.explanation.materialFacts.forEach((f) => assert(row.reason.includes(f), `starter material fact hidden: ${f}`));
  // The decisive comparison is named in the initial explanation.
  if (s.comparator) assert(row.reason.includes(s.comparator.name.toUpperCase()) || row.reason.includes(s.comparator.name), `comparator not named for ${s.slotLabel}`);
});
console.log("Super SAGE airtight state-change explanation contract: PASS");
