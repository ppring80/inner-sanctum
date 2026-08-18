// tests/patreon-multi-membership.test.js

"use strict";

const assert = require("assert");

const {
  extractEntitledTierIds,
  hasTier,
  isAcolyte,
  buildSessionPayload,
} = require("../netlify/functions/oauth-callback")._test;

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("PASS:", name);
  } catch (err) {
    failed += 1;
    console.error("FAIL:", name);
    console.error(err && err.stack ? err.stack : err);
  }
}

function member({
  id,
  patronStatus = "active_patron",
  tierIds = [],
}) {
  return {
    type: "member",
    id,
    attributes: {
      patron_status: patronStatus,
    },
    relationships: {
      currently_entitled_tiers: {
        data: tierIds.map((tierId) => ({
          type: "tier",
          id: String(tierId),
        })),
      },
    },
  };
}

// ============================================================
// REGRESSION 1
// Evan case:
// first Patreon membership is unrelated,
// second Patreon membership is Inner Sanctum.
//
// This is the exact defect fixed Aug 18, 2026.
// ============================================================

test("multi-membership patron gets access when Inner Sanctum tier is not first", () => {
  const identityJson = {
    included: [
      member({
        id: "other-creator-membership",
        tierIds: ["3115740"],
      }),

      member({
        id: "inner-sanctum-membership",
        tierIds: ["28845597"],
      }),
    ],
  };

  const entitledTierIds =
    extractEntitledTierIds(identityJson);

  assert.deepStrictEqual(
    entitledTierIds,
    ["3115740", "28845597"]
  );

  assert.strictEqual(
    isAcolyte(entitledTierIds),
    true
  );

  const payload =
    buildSessionPayload(
      entitledTierIds,
      new Date("2026-08-18T00:00:00Z")
    );

  assert.strictEqual(
    payload.fullAccess,
    true
  );
});

// ============================================================
// REGRESSION 2
// Single-membership patron still works exactly as before.
// ============================================================

test("single Inner Sanctum membership still receives access", () => {
  const identityJson = {
    included: [
      member({
        id: "inner-sanctum-membership",
        tierIds: ["28845597"],
      }),
    ],
  };

  const entitledTierIds =
    extractEntitledTierIds(identityJson);

  assert.deepStrictEqual(
    entitledTierIds,
    ["28845597"]
  );

  assert.strictEqual(
    isAcolyte(entitledTierIds),
    true
  );
});

// ============================================================
// REGRESSION 3
// Other Patreon memberships alone must NOT grant Inner Sanctum access.
// ============================================================

test("membership in other Patreon creators does not grant Inner Sanctum access", () => {
  const identityJson = {
    included: [
      member({
        id: "creator-one",
        tierIds: ["3115740"],
      }),

      member({
        id: "creator-two",
        tierIds: ["99999999"],
      }),
    ],
  };

  const entitledTierIds =
    extractEntitledTierIds(identityJson);

  assert.deepStrictEqual(
    entitledTierIds,
    ["3115740", "99999999"]
  );

  assert.strictEqual(
    isAcolyte(entitledTierIds),
    false
  );

  const payload =
    buildSessionPayload(
      entitledTierIds,
      new Date("2026-08-18T00:00:00Z")
    );

  assert.strictEqual(
    payload.fullAccess,
    false
  );
});

// ============================================================
// REGRESSION 4
// Inactive Patreon memberships must not contribute tier access.
// ============================================================

test("inactive Inner Sanctum membership does not grant access", () => {
  const identityJson = {
    included: [
      member({
        id: "inactive-inner-sanctum",
        patronStatus: "former_patron",
        tierIds: ["28845597"],
      }),
    ],
  };

  const entitledTierIds =
    extractEntitledTierIds(identityJson);

  assert.deepStrictEqual(
    entitledTierIds,
    []
  );

  assert.strictEqual(
    isAcolyte(entitledTierIds),
    false
  );
});

// ============================================================
// REGRESSION 5
// Mixed active + inactive memberships.
// Only active memberships contribute tier IDs.
// ============================================================

test("only active Patreon memberships contribute entitlement tiers", () => {
  const identityJson = {
    included: [
      member({
        id: "inactive-other",
        patronStatus: "former_patron",
        tierIds: ["11111111"],
      }),

      member({
        id: "active-inner-sanctum",
        patronStatus: "active_patron",
        tierIds: ["28845597"],
      }),
    ],
  };

  const entitledTierIds =
    extractEntitledTierIds(identityJson);

  assert.deepStrictEqual(
    entitledTierIds,
    ["28845597"]
  );

  assert.strictEqual(
    isAcolyte(entitledTierIds),
    true
  );
});

// ============================================================
// REGRESSION 6
// Duplicate tier IDs across memberships should be de-duplicated.
// ============================================================

test("duplicate entitled tier IDs are de-duplicated", () => {
  const identityJson = {
    included: [
      member({
        id: "membership-one",
        tierIds: ["28845597"],
      }),

      member({
        id: "membership-two",
        tierIds: ["28845597"],
      }),
    ],
  };

  const entitledTierIds =
    extractEntitledTierIds(identityJson);

  assert.deepStrictEqual(
    entitledTierIds,
    ["28845597"]
  );
});

// ============================================================
// REGRESSION 7
// Missing/invalid Patreon identity data fails closed.
// ============================================================

test("missing Patreon identity data fails closed", () => {
  assert.deepStrictEqual(
    extractEntitledTierIds(null),
    []
  );

  assert.deepStrictEqual(
    extractEntitledTierIds({}),
    []
  );

  assert.deepStrictEqual(
    extractEntitledTierIds({
      included: [],
    }),
    []
  );

  assert.strictEqual(
    isAcolyte([]),
    false
  );
});

// ============================================================
// REGRESSION 8
// hasTier remains fail-closed when no configured tier bucket exists.
// ============================================================

test("hasTier fails closed for an empty configured tier bucket", () => {
  assert.strictEqual(
    hasTier(
      ["28845597"],
      []
    ),
    false
  );

  assert.strictEqual(
    hasTier(
      ["28845597"],
      null
    ),
    false
  );
});

// ============================================================
// Summary
// ============================================================

console.log("");
console.log(
  `patreon-multi-membership.test.js: ${passed}/${passed + failed} passed`
);

if (failed > 0) {
  process.exitCode = 1;
}
