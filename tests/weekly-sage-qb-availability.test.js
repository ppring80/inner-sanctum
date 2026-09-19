const assert = require("assert");

const {
  availabilityForPlayer,
  WEEKLY_STARTERS
} = require("../netlify/functions/weekly-sage-qb-availability.js");
const { normalizeScoring } = require("../netlify/functions/weekly-sage-qb-leaderboard.js");

assert.strictEqual(normalizeScoring("half-ppr"), "half");
assert.strictEqual(WEEKLY_STARTERS["2026:2"].MIN, "Carson Wentz");

const kyler = availabilityForPlayer({ name: "Kyler Murray", team: "MIN" }, 2026, 2);
assert.strictEqual(kyler.eligible, false);
assert.strictEqual(kyler.status, "OUT");
assert.match(kyler.reason, /concussion/i);

const wentz = availabilityForPlayer({ name: "Carson Wentz", team: "MIN" }, 2026, 2);
assert.strictEqual(wentz.eligible, true);
assert.strictEqual(wentz.status, "CONFIRMED_STARTER");

const minnesotaBackup = availabilityForPlayer(
  { name: "Other Quarterback", team: "MIN" }, 2026, 2
);
assert.strictEqual(minnesotaBackup.eligible, false);
assert.strictEqual(minnesotaBackup.confirmedStarter, "Carson Wentz");

const stafford = availabilityForPlayer({ name: "Matthew Stafford", team: "LAR" }, 2026, 2);
assert.strictEqual(stafford.eligible, true);
assert.strictEqual(stafford.status, "CONFIRMED_STARTER");

const futureKyler = availabilityForPlayer({ name: "Kyler Murray", team: "MIN" }, 2026, 3);
assert.strictEqual(futureKyler.eligible, true, "Dated weekly facts must expire.");

console.log("weekly-sage-qb-availability.test.js passed");
