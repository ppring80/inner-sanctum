// tests/draft-fit-scenarios.test.js

"use strict";

const assert = require("assert");

const {
  FIT,
  ACTION,
  DEFAULT_LINEUP,
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

function threeWrLineup() {
  return {
    QB: 1,
    RB: 2,
    WR: 3,
    TE: 1,
    FLEX: 1,
    K: 1,
    DEF: 1,
  };
}

function doubleFlexLineup() {
  return {
    QB: 1,
    RB: 2,
    WR: 2,
    TE: 1,
    FLEX: 2,
    K: 1,
    DEF: 1,
  };
}

// ============================================================
// SCENARIO 1
// Cook + Bowers, zero WR.
// WR is exposed and no WR projects to survive.
// ============================================================

test("Cook + Bowers: Flowers becomes Excellent Fit when WR next-turn depth disappears", () => {
  const result = buildDraftFitProfile({
    candidate: player("Zay Flowers", "WR", 30.1),
    sage: sage("consider-now"),

    myRoster: [
      player("James Cook III", "RB"),
      player("Brock Bowers", "TE"),
    ],

    lineup: standardLineup(),

    nextTurnPool: [
      player("Bucky Irving", "RB", 40),
      player("George Kittle", "TE", 41),
    ],
  });

  assert.strictEqual(result.fit, FIT.EXCELLENT);
  assert.strictEqual(result.action, ACTION.PROMOTE);
  assert.strictEqual(result.diagnostics.fillsDedicated, true);
  assert.strictEqual(result.diagnostics.nextTurnDepth, false);
});

// ============================================================
// SCENARIO 2
// Same roster, but WR depth is projected to survive.
// Draft Fit should recognize the starting fit without inventing urgency.
// ============================================================

test("Cook + Bowers: Flowers is Good Fit when WR alternatives project to survive", () => {
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
  assert.strictEqual(result.diagnostics.nextTurnDepth, true);
});

// ============================================================
// SCENARIO 3
// Bowers already rostered.
// McBride is TE2, but FLEX is open.
// He must NOT be treated as redundant.
// ============================================================

test("Bowers + McBride: second elite TE remains a valid FLEX starter", () => {
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
  assert.strictEqual(result.diagnostics.fillsDedicated, false);
  assert.strictEqual(result.diagnostics.fillsFlex, true);
  assert.strictEqual(result.diagnostics.wouldBeDepth, false);
});

// ============================================================
// SCENARIO 4
// Bowers + McBride already consume TE + FLEX.
// A third ordinary TE would be depth while WR is exposed.
// ============================================================

test("Bowers + McBride: third ordinary TE receives roster pressure when WR is exposed", () => {
  const result = buildDraftFitProfile({
    candidate: player("Third TE", "TE", 48),
    sage: sage("consider-now"),

    myRoster: [
      player("Brock Bowers", "TE"),
      player("Trey McBride", "TE"),
    ],

    lineup: standardLineup(),

    nextTurnPool: [
      player("RB Depth", "RB", 50),
    ],
  });

  assert.strictEqual(result.fit, FIT.PRESSURE);
  assert.strictEqual(result.action, ACTION.PRESSURE);
  assert.strictEqual(result.diagnostics.wouldBeDepth, true);
});

// ============================================================
// SCENARIO 5
// Same roster problem, but the third TE is extraordinary value.
// Strong SAGE value must be allowed to override imbalance.
// ============================================================

test("third elite TE can trigger Value Override instead of a hard positional ban", () => {
  const result = buildDraftFitProfile({
    candidate: player("Elite Falling TE", "TE", 22),
    sage: sage("take-now"),

    myRoster: [
      player("Brock Bowers", "TE"),
      player("Trey McBride", "TE"),
    ],

    lineup: standardLineup(),

    nextTurnPool: [
      player("RB Depth", "RB", 50),
    ],
  });

  assert.strictEqual(result.fit, FIT.VALUE_OVERRIDE);
  assert.strictEqual(result.action, ACTION.VALUE_OVERRIDE);
});

// ============================================================
// SCENARIO 6
// RB-heavy start, zero WR.
// WR should receive strong positive Draft Fit treatment.
// ============================================================

test("RB-heavy roster with zero WR strongly favors a viable WR starter when WR depth is drying up", () => {
  const result = buildDraftFitProfile({
    candidate: player("Garrett Wilson", "WR", 30.8),
    sage: sage("consider-now"),

    myRoster: [
      player("James Cook III", "RB"),
      player("Jonathan Taylor", "RB"),
      player("Ashton Jeanty", "RB"),
      player("Brock Bowers", "TE"),
    ],

    lineup: standardLineup(),

    nextTurnPool: [
      player("RB Depth", "RB", 40),
      player("TE Depth", "TE", 42),
    ],
  });

  assert.strictEqual(result.fit, FIT.EXCELLENT);
  assert.strictEqual(result.action, ACTION.PROMOTE);
  assert.strictEqual(result.diagnostics.fillsDedicated, true);
});

// ============================================================
// SCENARIO 7
// Same RB-heavy roster.
// Another ordinary RB would be bench depth.
// WR alternatives still exist, so pressure exists but is not emergency.
// ============================================================

test("fourth ordinary RB receives roster pressure when WR starting slots remain empty", () => {
  const result = buildDraftFitProfile({
    candidate: player("Chase Brown", "RB", 17.6),
    sage: sage("consider-now"),

    myRoster: [
      player("James Cook III", "RB"),
      player("Jonathan Taylor", "RB"),
      player("Ashton Jeanty", "RB"),
      player("Brock Bowers", "TE"),
    ],

    lineup: standardLineup(),

    nextTurnPool: [
      player("Zay Flowers", "WR", 30.1),
      player("Garrett Wilson", "WR", 30.8),
      player("RB Depth", "RB", 41),
    ],
  });

  assert.strictEqual(result.fit, FIT.PRESSURE);
  assert.strictEqual(result.action, ACTION.PRESSURE);
  assert.strictEqual(result.diagnostics.wouldBeDepth, true);
});

// ============================================================
// SCENARIO 8
// Same RB-heavy roster, but an elite RB has fallen.
// Exceptional value must still win.
// ============================================================

test("elite RB fall creates Value Override even on an RB-heavy roster", () => {
  const result = buildDraftFitProfile({
    candidate: player("Elite Falling RB", "RB", 8),
    sage: sage("take-now"),

    myRoster: [
      player("James Cook III", "RB"),
      player("Jonathan Taylor", "RB"),
      player("Ashton Jeanty", "RB"),
      player("Brock Bowers", "TE"),
    ],

    lineup: standardLineup(),

    nextTurnPool: [
      player("Zay Flowers", "WR", 30.1),
      player("Garrett Wilson", "WR", 30.8),
    ],
  });

  assert.strictEqual(result.fit, FIT.VALUE_OVERRIDE);
  assert.strictEqual(result.action, ACTION.VALUE_OVERRIDE);
  assert.strictEqual(result.diagnostics.wouldBeDepth, true);
});

// ============================================================
// SCENARIO 9
// Balanced starting roster.
// Draft Fit should get out of SAGE's way.
// ============================================================

test("balanced completed starting lineup leaves pure depth decisions to SAGE", () => {
  const result = buildDraftFitProfile({
    candidate: player("Depth WR", "WR", 60),
    sage: sage("consider"),

    myRoster: [
      player("QB One", "QB"),
      player("RB One", "RB"),
      player("RB Two", "RB"),
      player("WR One", "WR"),
      player("WR Two", "WR"),
      player("TE One", "TE"),
      player("Flex RB", "RB"),
      player("K One", "K"),
      player("DEF One", "DEF"),
    ],

    lineup: standardLineup(),

    nextTurnPool: [],
  });

  assert.strictEqual(result.fit, FIT.NEUTRAL);
  assert.strictEqual(result.action, ACTION.HOLD);
});

// ============================================================
// SCENARIO 10
// 3-WR league.
// The lineup template itself must create another WR starting need.
// ============================================================

test("3-WR lineup correctly treats WR3 as a dedicated starter", () => {
  const result = buildDraftFitProfile({
    candidate: player("WR Three", "WR", 36),
    sage: sage("consider-now"),

    myRoster: [
      player("WR One", "WR"),
      player("WR Two", "WR"),
      player("RB One", "RB"),
      player("RB Two", "RB"),
      player("TE One", "TE"),
    ],

    lineup: threeWrLineup(),

    nextTurnPool: [
      player("RB Depth", "RB", 45),
    ],
  });

  assert.strictEqual(result.fit, FIT.EXCELLENT);
  assert.strictEqual(result.action, ACTION.PROMOTE);
  assert.strictEqual(result.diagnostics.fillsDedicated, true);
});

// ============================================================
// SCENARIO 11
// Double FLEX.
// A third TE can still be a starter when TE + FLEX1 are occupied.
// ============================================================

test("Double FLEX keeps a third TE startable when the second FLEX slot remains open", () => {
  const result = buildDraftFitProfile({
    candidate: player("Third Elite TE", "TE", 28),
    sage: sage("take-now"),

    myRoster: [
      player("Brock Bowers", "TE"),
      player("Trey McBride", "TE"),
    ],

    lineup: doubleFlexLineup(),

    nextTurnPool: [],
  });

  assert.strictEqual(result.fit, FIT.GOOD);
  assert.strictEqual(result.action, ACTION.HOLD);
  assert.strictEqual(result.diagnostics.fillsFlex, true);
  assert.strictEqual(result.diagnostics.wouldBeDepth, false);
});

// ============================================================
// SCENARIO 12
// Guardrail for current V1 scope.
//
// leagueSize and scoring are not consumed by Draft Fit yet.
// Supplying them must not silently change the current result.
// This test documents that explicitly rather than pretending otherwise.
// ============================================================

test("V1 does not silently change Draft Fit based on unused leagueSize or scoring fields", () => {
  const common = {
    candidate: player("Zay Flowers", "WR", 30.1),
    sage: sage("consider-now"),

    myRoster: [
      player("James Cook III", "RB"),
      player("Brock Bowers", "TE"),
    ],

    lineup: standardLineup(),

    nextTurnPool: [
      player("Garrett Wilson", "WR", 30.8),
    ],
  };

  const ppr12 = buildDraftFitProfile(
    Object.assign({}, common, {
      scoring: "ppr",
      leagueSize: 12,
    })
  );

  const standard8 = buildDraftFitProfile(
    Object.assign({}, common, {
      scoring: "standard",
      leagueSize: 8,
    })
  );

  assert.strictEqual(ppr12.fit, standard8.fit);
  assert.strictEqual(ppr12.action, standard8.action);
  assert.strictEqual(ppr12.explanation, standard8.explanation);
});

// ============================================================
// Summary
// ============================================================

console.log("");
console.log(
  `draft-fit-scenarios.test.js: ${passed}/${passed + failed} passed`
);

if (failed > 0) {
  process.exitCode = 1;
}
