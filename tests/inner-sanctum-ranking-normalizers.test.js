const assert = require("assert");

const {
  cleanRankingText,
  isUnavailableRosterStatus
} = require(
  "../netlify/functions/inner-sanctum-ranking-normalizers"
);

assert.strictEqual(
  cleanRankingText({ label: "START" }),
  "START"
);
assert.strictEqual(
  cleanRankingText({ signal: "Positive" }),
  "Positive"
);
assert.strictEqual(
  cleanRankingText({ nested: { value: "bad" } }),
  null,
  "Objects without an approved text field must never become [object Object]."
);
assert.strictEqual(cleanRankingText("FLEX"), "FLEX");

["RS", "reserve", "IR", "injured-reserve", "inactive"]
  .forEach(status => {
    assert.strictEqual(
      isUnavailableRosterStatus(status),
      true,
      `${status} must be unavailable for active lineup slots.`
    );
  });

["A", "active", "questionable", ""]
  .forEach(status => {
    assert.strictEqual(
      isUnavailableRosterStatus(status),
      false,
      `${status || "blank"} must not be excluded by this narrow guardrail.`
    );
  });

console.log(
  "inner-sanctum-ranking-normalizers.test.js passed"
);
