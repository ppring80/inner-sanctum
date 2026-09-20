const assert = require("assert");
const { availabilityForPlayer } = require("../netlify/functions/weekly-sage-wr-availability.js");

for (const status of ["OUT", "IR", "INACTIVE", "RESERVE/INJURED", "SUSPENDED", "RESERVE/PUP", "RESERVE/NFI"]) {
  const result = availabilityForPlayer({ name: "Unavailable WR", injuryStatus: status });
  assert.strictEqual(result.eligible, false, `${status} must be hard unavailable`);
  assert.strictEqual(result.status, status.replace(/_/g, " "));
}

for (const status of ["QUESTIONABLE", "DOUBTFUL", "LIMITED"]) {
  const result = availabilityForPlayer({ name: "Risky WR", injuryStatus: status });
  assert.strictEqual(result.eligible, true, `${status} must remain visible and rankable`);
  assert.strictEqual(result.status, status);
}

assert.strictEqual(availabilityForPlayer({ status: "Exempt/Commissioner Permission", eligible: true }).eligible, true);
assert.strictEqual(availabilityForPlayer({ eligible: false }).eligible, false);

const flowers = availabilityForPlayer({ name: "Zay Flowers", team: "BAL" }, 2026, 2);
assert.strictEqual(flowers.eligible, false);
assert.strictEqual(flowers.status, "OUT");

const futureFlowers = availabilityForPlayer({ name: "Zay Flowers", team: "BAL" }, 2026, 3);
assert.strictEqual(futureFlowers.eligible, true, "Dated weekly facts must expire.");

console.log("weekly-sage-wr-availability.test.js passed");
