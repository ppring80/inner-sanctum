"use strict";
const assert = require("assert");
const fs = require("fs");
const html = fs.readFileSync("weekly.html", "utf8");

assert(html.includes("posFilter: 'ALL'"), "Weekly Rankings must default to ALL");
assert(
  !html.includes("p.eligibleForWeeklyRanking === false && !state.myRosterOnly && !q"),
  "Default ALL must not silently hide ranked rows by eligibility"
);
assert(
  html.includes("function getAllRows()"),
  "ALL view must continue to render the already-loaded Weekly SAGE rows"
);
console.log("Weekly Rankings ALL-means-all display contract: PASS");
