const assert = require("assert");

const {
  availabilityForPlayer,
  weeklyUnavailableFacts,
  applyBackfieldOpportunityAdjustments
} = require("../netlify/functions/weekly-sage-rb-availability");
const { normalizeScoring } = require("../netlify/functions/weekly-sage-rb-leaderboard");

assert.strictEqual(normalizeScoring("half-ppr"), "half");
assert.strictEqual(normalizeScoring("half_ppr"), "half");
assert.strictEqual(normalizeScoring("0.5-ppr"), "half");

const jacobs = availabilityForPlayer({ name: "Josh Jacobs" }, 2026, 2);
assert.strictEqual(jacobs.eligible, false);
assert.strictEqual(jacobs.status, "COMMISSIONER_EXEMPT_NO_PLAY");

const sampson = availabilityForPlayer({ name: "Dylan Sampson" }, 2026, 2);
assert.strictEqual(sampson.eligible, false);
assert.strictEqual(sampson.status, "IR");

const administrativeExempt = availabilityForPlayer({
  name: "Eligible Player",
  status: "Exempt/Commissioner Permission",
  eligible: true
}, 2026, 2);
assert.strictEqual(administrativeExempt.eligible, true);

const futureJacobs = availabilityForPlayer({ name: "Josh Jacobs" }, 2026, 3);
assert.strictEqual(futureJacobs.eligible, true, "Dated weekly facts must expire.");

assert.ok(
  weeklyUnavailableFacts(2026, 2).some(player =>
    player.name === "Jordan Mason" && player.team === "MIN"
  ),
  "Unavailable teammates must survive even when absent from a depth chart."
);

const leaderboard = [
  { name: "Aaron Jones Sr.", team: "MIN", sage: { rankingScore: 55 } },
  { name: "Other Back", team: "MIN", sage: { rankingScore: 40 } }
];
const adjustments = applyBackfieldOpportunityAdjustments({
  leaderboard,
  unavailablePlayers: [{
    name: "Jordan Mason", team: "MIN", availability: {
      status: "OUT", backfieldRole: "committee", vacatedOpportunity: 0.45
    }
  }]
});
assert.strictEqual(leaderboard[0].sage.rankingScore, 59);
assert.strictEqual(leaderboard[1].sage.rankingScore, 40);
assert.strictEqual(adjustments.length, 1);

const reserveOnly = [
  { name: "Lead Back", team: "CLE", sage: { rankingScore: 60 } },
  { name: "Reserve Back", team: "CLE", sage: { rankingScore: 35 } }
];
const reserveAdjustments = applyBackfieldOpportunityAdjustments({
  leaderboard: reserveOnly,
  unavailablePlayers: [{
    name: "Reserve Teammate", team: "CLE", availability: {
      status: "IR", backfieldRole: "reserve", vacatedOpportunity: 0.10
    }
  }]
});
assert.strictEqual(reserveOnly[0].sage.rankingScore, 61);
assert.strictEqual(reserveOnly[1].sage.rankingScore, 35);
assert.strictEqual(reserveAdjustments.length, 1);

const unknownRole = [
  { name: "Lead Back", team: "FA", sage: { rankingScore: 60 } }
];
assert.deepStrictEqual(applyBackfieldOpportunityAdjustments({
  leaderboard: unknownRole,
  unavailablePlayers: [{
    name: "Unknown Back", team: "FA", availability: { status: "OUT" }
  }]
}), [], "Unknown workload must not create an automatic boost.");

console.log("weekly-sage-rb-availability.test.js passed");
