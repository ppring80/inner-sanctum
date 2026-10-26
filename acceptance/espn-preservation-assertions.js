"use strict";
// Test artifact only: fixed synthetic inputs, no invocation/user data or I/O writes.
const names = ["player_slot_associations", "league_team_season_binding", "distinct_period_and_week",
  "capture_timestamp_presence", "missing_capture_timestamp_unknown", "eligibility_unknown", "lock_unknown"];
function run(storedCases) {
  const checks = Object.fromEntries(names.map(name => [name, true]));
  let stage = "INITIALIZATION";
  let errorCategory = "NONE";
  try {
    const { acceptanceCanonical: canonical } = require("../netlify/functions/league-snapshot");
    const { extractRosterEntries } = require("../netlify/functions/chatgpt-mcp")._test;
    stage = "ASSERTIONS";
    for (const [team, period, week, capturedAt] of [["synthetic-a",7,8,storedCases ? storedCases["synthetic-a"].capturedAt : "2026-10-22T12:00:00Z"],["synthetic-b",9,10,null]]) {
      const input = {provider:"espn",league:{id:"synthetic-league",season:2026,scoringPeriodId:period,teamCount:12},
        team:{id:team},week,scoringFormat:"ppr",roster:[{name:"Synthetic WR",position:"WR",providerPlayerId:team+"-player",lineupSlotId:4}],
        espnLineupSource:{scoringPeriodId:period,week,capturedAt},meta:{source:"espn-browser-assisted",capturedAt}};
      const stored = storedCases ? storedCases[team].snapshot : canonical(input);
      const c = extractRosterEntries(stored)[0].lineupContext;
      checks.player_slot_associations &&= c.playerId===team+"-player" && c.originalSlotId==="4";
      checks.league_team_season_binding &&= c.leagueId==="synthetic-league" && c.teamId===team && c.season===2026;
      checks.distinct_period_and_week &&= c.scoringPeriodId===period && c.week===week && c.week!==c.scoringPeriodId;
      checks.capture_timestamp_presence &&= capturedAt===null || c.asOf===capturedAt;
      checks.missing_capture_timestamp_unknown &&= capturedAt!==null || c.asOf===null;
      checks.eligibility_unknown &&= c.eligibility.status==="unknown" && c.eligibility.source===null && c.eligibility.asOf===null;
      checks.lock_unknown &&= c.lock.state==="unknown" && c.lock.source===null && c.lock.asOf===null;
    }
    stage = "COMPLETE";
  } catch {
    errorCategory = stage === "INITIALIZATION" ? "INITIALIZATION_FAILED" : "EXECUTION_FAILED";
    // Never propagate exception text, source data, invocation data or stack traces.
    for (const name of names) checks[name] = false;
  }
  return { buildSha: require("./build-identity.json").sourceCommit, stage, errorCategory, assertions: Object.fromEntries(names.map(name => [name, checks[name] ? "PASS" : "FAIL"])) };
}
function register(server, z) {
  server.registerTool("get_espn_preservation_assertions", {
    title:"Synthetic ESPN preservation assertions",
    description:"Test-only read-only fixed synthetic assertions. No roster input, private data or provider calls.",
    inputSchema:z.object({}),
    outputSchema:z.object({buildSha:z.string().regex(/^[a-f0-9]{40}$/),stage:z.enum(["INITIALIZATION","ASSERTIONS","COMPLETE"]),errorCategory:z.enum(["NONE","INITIALIZATION_FAILED","EXECUTION_FAILED"]),assertions:z.object(Object.fromEntries(names.map(name => [name,z.enum(["PASS","FAIL"])]))).strict()}).strict()
  }, async () => {
    const result = run();
    return {content:[{type:"text",text:JSON.stringify(result)}],structuredContent:result};
  });
}
module.exports = { run, register };
