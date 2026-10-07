"use strict";
const assert=require("assert"),fs=require("fs");
const html=fs.readFileSync("weekly.html","utf8");
assert(html.includes("var aUnavailable = a.eligibleForWeeklyRanking === false ? 1 : 0;"));
assert(html.includes("if (aUnavailable !== bUnavailable) return aUnavailable - bUnavailable;"));
assert(html.includes("return a.positionRank - b.positionRank;"));
assert(!html.includes("p.eligibleForWeeklyRanking === false && !state.myRosterOnly && !q"));
console.log("Weekly Rankings authoritative ordering + visible inactive appendix contract: PASS");
