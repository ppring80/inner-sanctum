// tests/draft-fit-profile.test.js

"use strict";

const assert = require("assert");

const {
  FIT,
  ACTION,
  DEFAULT_LINEUP,
  buildRosterOccupancy,
  candidateCanFillDedicatedSlot,
  candidateCanFillFlex,
  candidateCanStart,
  buildDraftFitProfile,
} = require("../netlify/functions/draft-fit-profile");

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

function player(name, pos, adp) {
  return { name, pos, adp };
}

function sage(code) {
  return { code };
}

function standardLineup() {
  return Object.assign({}, DEFAULT_LINEUP);
}

// ------------------------------------------------------------
// 1. Basic roster occupancy
// ------------------------------------------------------------

test("empty roster exposes normal starting slots and FLEX", () => {
  const occupancy = buildRosterOccupancy([], standardLineup());

  assert.strictEqual(occupancy.dedicatedOpen.QB, 1);
  assert.strictEqual(occupancy.dedicatedOpen.RB, 2);
  assert.strictEqual(occupancy.dedicatedOpen.WR, 2);
  assert.strictEqual(occupancy.dedicatedOpen.TE, 1);
  assert.strictEqual(occupancy.flexOpen, 1);
});

test("Cook plus Bowers fills RB1 and TE while leaving FLEX open", () => {
  const roster = [
    player("James Cook III", "RB"),
    player("Brock Bowers", "TE"),
  ];

  const occupancy = buildRosterOccupancy(roster, standardLineup());

  assert.strictEqual(occupancy.dedicatedOpen.RB, 1);
  assert.strictEqual(occupancy.dedicatedOpen.WR, 2);
  assert.strictEqual(occupancy.dedicatedOpen.TE, 0);
  assert.strictEqual(occupancy.flexOpen, 1);
});

// ------------------------------------------------------------
// 2. FLEX handling
// ------------------------------------------------------------

test("second elite TE can still fill FLEX when TE is already filled", () => {
  const roster = [
    player("Brock Bowers", "TE"),
  ];

  const occupancy = buildRosterOccupancy(roster, standardLineup());
  const mcBride = player("Trey McBride", "TE");

  assert.strictEqual(
    candidateCanFillDedicatedSlot(mcBride, occupancy),
    false
  );

  assert.strictEqual(
    candidateCanFillFlex(mcBride, occupancy),
    true
  );

  assert.strictEqual(
    candidateCanStart(mcBride, occupancy),
    true
  );
});

test("third TE becomes depth after TE and FLEX are occupied", () => {
  const roster = [
    player("Brock Bowers", "TE"),
    player("Trey McBride", "TE"),
  ];

  const occupancy = buildRosterOccupancy(roster, standardLineup());
  const thirdTe = player("Sam LaPorta", "TE");

  assert.strictEqual(
    candidateCanFillDedicatedSlot(thirdTe, occupancy),
    false
  );

  assert.strictEqual(
    candidateCanFillFlex(thirdTe, occupancy),
    false
  );

  assert.strictEqual(
    candidateCanStart(thirdTe, occupancy),
    false
  );
});

// ------------------------------------------------------------
// 3. Dedicated starter fit
// ------------------------------------------------------------

test("WR filling an open WR slot is Good Fit when next-turn WR depth remains", () => {
  const result = buildDraftFitProfile({
    candidate: player("Zay Flowers", "WR", 30.1),
    sage: sage("consider-now"),
    myRoster: [
      player("James Cook III", "RB"),
      player("Brock Bowers", "TE"),
    ],
    lineup: standardLineup(),
    nextTurnPool: [
      player("Garrett Wilson", "WR", 30.8),
      player("Mike Evans", "WR", 34.2),
    ],
  });

  assert.strictEqual(result.fit, FIT.GOOD);
  assert.strictEqual(result.action, ACTION.HOLD);
  assert.strictEqual(result.diagnostics.fillsDedicated, true);
});

test("WR filling an open WR slot becomes Excellent Fit when no WR projects to survive", () => {
  const result = buildDraftFitProfile({
    candidate: player("Zay Flowers", "WR", 30.1),
    sage: sage("consider-now"),
    myRoster: [
      player("James Cook III", "RB"),
      player("Brock Bowers", "TE"),
    ],
    lineup: standardLineup(),
    nextTurnPool: [
      player("Rachaad White", "RB", 35),
      player("George Kittle", "TE", 36),
    ],
  });

  assert.strictEqual(result.fit, FIT.EXCELLENT);
  assert.strictEqual(result.action, ACTION.PROMOTE);
  assert.strictEqual(result.diagnostics.nextTurnDepth, false);
});

// ------------------------------------------------------------
// 4. Second TE with FLEX
// ------------------------------------------------------------

test("McBride is not penalized merely because Bowers is already rostered", () => {
  const result = buildDraftFitProfile({
    candidate: player("Trey McBride", "TE", 20.8),
    sage: sage("take-now"),
    myRoster: [
      player("Brock Bowers", "TE"),
    ],
    lineup: standardLineup(),
    nextTurnPool: [],
  });

  assert.strictEqual(result.fit, FIT.GOOD);
  assert.strictEqual(result.action, ACTION.HOLD);
  assert.strictEqual(result.diagnostics.fillsFlex, true);
  assert.strictEqual(result.diagnostics.wouldBeDepth, false);
});

// ------------------------------------------------------------
// 5. Roster pressure
// ------------------------------------------------------------

test("third RB receives roster pressure when WR is exposed and RB would be depth", () => {
  const roster = [
    player("James Cook III", "RB"),
    player("Jonathan Taylor", "RB"),
    player("Ashton Jeanty", "RB"),
    player("Brock Bowers", "TE"),
  ];

  const result = buildDraftFitProfile({
    candidate: player("Chase Brown", "RB", 17.6),
    sage: sage("consider-now"),
    myRoster: roster,
    lineup: standardLineup(),
    nextTurnPool: [
      player("Bucky Irving", "RB", 40),
      player("David Montgomery", "RB", 44),
    ],
  });

  assert.strictEqual(result.fit, FIT.PRESSURE);
  assert.strictEqual(result.action, ACTION.PRESSURE);
  assert.strictEqual(result.diagnostics.wouldBeDepth, true);
});

// ------------------------------------------------------------
// 6. Value override
// ------------------------------------------------------------

test("strong SAGE value can override temporary roster imbalance", () => {
  const roster = [
    player("James Cook III", "RB"),
    player("Jonathan Taylor", "RB"),
    player("Ashton Jeanty", "RB"),
    player("Brock Bowers", "TE"),
  ];

  const result = buildDraftFitProfile({
    candidate: player("Elite Falling RB", "RB", 8),
    sage: sage("take-now"),
    myRoster: roster,
    lineup: standardLineup(),
    nextTurnPool: [
      player("Bucky Irving", "RB", 40),
    ],
  });

  assert.strictEqual(result.fit, FIT.VALUE_OVERRIDE);
  assert.strictEqual(result.action, ACTION.VALUE_OVERRIDE);
});

// ------------------------------------------------------------
// 7. Balanced roster leaves SAGE alone
// ------------------------------------------------------------

test("balanced starting lineup produces Neutral Fit for pure depth", () => {
  const roster = [
    player("QB One", "QB"),
    player("RB One", "RB"),
    player("RB Two", "RB"),
    player("WR One", "WR"),
    player("WR Two", "WR"),
    player("TE One", "TE"),
    player("Flex RB", "RB"),
    player("K One", "K"),
    player("DEF One", "DEF"),
  ];

  const result = buildDraftFitProfile({
    candidate: player("Depth WR", "WR", 55),
    sage: sage("consider"),
    myRoster: roster,
    lineup: standardLineup(),
    nextTurnPool: [],
  });

  assert.strictEqual(result.fit, FIT.NEUTRAL);
  assert.strictEqual(result.action, ACTION.HOLD);
});

// ------------------------------------------------------------
// 8. Live Cook + Bowers scenario
// ------------------------------------------------------------

test("Cook plus Bowers makes Flowers a positive starting fit", () => {
  const result = buildDraftFitProfile({
    candidate: player("Zay Flowers", "WR", 30.1),
    sage: sage("consider-now"),
    myRoster: [
      player("James Cook III", "RB"),
      player("Brock Bowers", "TE"),
    ],
    lineup: standardLineup(),
    nextTurnPool: [],
  });

  assert.strictEqual(result.fit, FIT.EXCELLENT);
  assert.strictEqual(result.action, ACTION.PROMOTE);
});

test("Cook plus Bowers still allows Jeanty as a starting RB2", () => {
  const result = buildDraftFitProfile({
    candidate: player("Ashton Jeanty", "RB", 16.9),
    sage: sage("take-now"),
    myRoster: [
      player("James Cook III", "RB"),
      player("Brock Bowers", "TE"),
    ],
    lineup: standardLineup(),
    nextTurnPool: [],
  });

  assert.strictEqual(result.fit, FIT.EXCELLENT);
  assert.strictEqual(result.action, ACTION.PROMOTE);
  assert.strictEqual(result.diagnostics.fillsDedicated, true);
});

// ------------------------------------------------------------
// Summary
// ------------------------------------------------------------

console.log("");
console.log(
  `draft-fit-profile.test.js: ${passed}/${passed + failed} passed`
);

if (failed > 0) {
  process.exitCode = 1;
}
