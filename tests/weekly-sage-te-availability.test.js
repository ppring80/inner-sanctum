const assert = require("assert");
const { availabilityForPlayer } = require("../netlify/functions/weekly-sage-te-availability.js");
const { applyAvailabilityRiskAdjustments } = require("../netlify/functions/weekly-sage-te-leaderboard.js");

const chig = availabilityForPlayer({ name: "Chig Okonkwo", team: "WSH" }, 2026, 2);
assert.strictEqual(chig.eligible, false);
assert.strictEqual(chig.status, "OUT");

const bowers = availabilityForPlayer({ name: "Brock Bowers", team: "LV" }, 2026, 2);
assert.strictEqual(bowers.eligible, true);
assert.strictEqual(bowers.status, "DOUBTFUL");

const doubtfulRows = [{
  name: "Brock Bowers", rankingScore: 98, sageScore: 29.3,
  recommendation: "FLEX", availability: bowers
}];
assert.deepStrictEqual(applyAvailabilityRiskAdjustments(doubtfulRows), { adjusted: 1 });
assert.strictEqual(doubtfulRows[0].rankingScore, 68);
assert.strictEqual(doubtfulRows[0].recommendation, "SIT");

const futureChig = availabilityForPlayer({ name: "Chig Okonkwo", team: "WSH" }, 2026, 3);
assert.strictEqual(futureChig.eligible, true, "Dated weekly facts must expire.");

console.log("weekly-sage-te-availability.test.js passed");
