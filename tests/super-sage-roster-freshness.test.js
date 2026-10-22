"use strict";

const assert = require("assert");
const fs = require("fs");
const { _test } = require("../netlify/functions/chatgpt-mcp.js");

const HOUR = 60 * 60 * 1000;
const now = Date.parse("2026-10-04T12:00:00.000Z");

assert.strictEqual(_test.MAX_LINKED_ROSTER_AGE_MS, 12 * HOUR);
assert.strictEqual(_test.linkedRosterFreshness({ syncedAt: "2026-10-04T01:00:00.000Z" }, now).fresh, true);
assert.strictEqual(_test.linkedRosterFreshness({ syncedAt: "2026-10-03T23:59:59.000Z" }, now).fresh, false);
assert.strictEqual(_test.linkedRosterFreshness({}, now).fresh, false);

const src = fs.readFileSync("netlify/functions/chatgpt-mcp.js", "utf8");
assert(src.includes("Reconnect/refresh the league before SAGE makes a lineup recommendation."));
assert(src.includes('error: freshness.reason'));

// Roster provenance invariant: the shared authority receives candidates only
// from the captured roster matcher; it never appends Weekly SAGE rows to the
// provider roster candidate pool.
const decision = fs.readFileSync("netlify/functions/_super-sage-lineup-decision.js", "utf8");
assert(decision.includes("function candidatesFromMatched(matched, unmatched = [], rankings = null)"));
assert(!decision.includes("candidates.push(...rankings"), "rankings must never inject non-roster players");

console.log("Super SAGE connected-roster freshness/provenance contract: PASS");
