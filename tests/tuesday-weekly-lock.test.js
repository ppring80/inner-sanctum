"use strict";
const assert=require("assert"),fs=require("fs");
const toml=fs.readFileSync("netlify.toml","utf8");
const workflow=fs.readFileSync(".github/workflows/weekly-tools-health.yml","utf8");
const verify=fs.readFileSync("scripts/verify-weekly-tools.js","utf8");
const weekly=fs.readFileSync("weekly.html","utf8");

assert(toml.includes('[functions."recover-weekly-sage"]'));
assert(toml.includes('schedule = "*/10 * * * *"'),"weekly recovery must run every ten minutes");
assert(workflow.includes("cron: '0 13,14 * 1,9-12 2'"),"Tuesday production acceptance must run early across Pacific DST offsets");
assert(verify.includes("Weekly caches incomplete"));
assert(verify.includes("authoritative position ranks are missing or out of order"));
assert(verify.includes("no matched projections"));
assert(verify.includes("Newswire stale"));
assert(weekly.includes("return a.positionRank - b.positionRank;"),"website must preserve authoritative position order");
assert(weekly.includes("if (aUnavailable !== bUnavailable) return aUnavailable - bUnavailable;"),"inactive rows must not outrank ranked rows");
console.log("Tuesday weekly rollover/recovery/acceptance lock: PASS");
