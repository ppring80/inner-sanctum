// tests/draft-intelligence-scenarios.test.js

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
  return {
    name,
    pos,
    adp,
  };
}

function sage(code) {
  return { code };
}

function standardLineup() {
  return Object.assign({}, DEFAULT_LINEUP);
}

/*
 * INNER SANCTUM — DRAFT INTELLIGENCE SCENARIO GUARDRAILS
 *
 * PURPOSE
 * -------
 * These tests define what information Draft Fit must preserve for
 * the eventual Draft Intelligence decision layer.
 *
 * They do NOT yet rank multiple players against one another.
 *
 * Draft Intelligence will eventually answer:
 *
 *   "Given SAGE + Draft Fit + my roster + the draft board,
 *    who should I actually select?"
 *
 * These tests protect four principles:
 *
 * 1. Roster construction matters when player choices are close.
 * 2. A second elite TE is not automatically redundant when FLEX is open.
 * 3. Exceptional value must remain eligible to override roster imbalance.
 * 4. League/scoring context may be passed forward without Draft Fit
 *    silently inventing unsupported scoring adjustments.
 */

// ============================================================
// SCENARIO 1
// Cook + Bowers, no WR.
//
// Jeanty is still a legitimate starting RB2.
// Flowers fills WR1.
//
// Draft Fit should distinguish both as useful starting additions.
// Final ordering belongs to Draft Intelligence.
// ============================================================

test("Scenario 1: Cook + Bowers preserves both elite RB value and WR roster fit", () => {
  const myRoster = [
    player("James Cook III", "RB", 20),
    player("Brock Bowers", "TE", 18),
  ];

  const jeanty = buildDraftFitProfile({
    candidate: player("Ashton Jeanty", "RB", 16.9),
    sage: sage("take-now"),
    myRoster,
    lineup: standardLineup(),
    nextTurnPool: [
      player("Zay Flowers", "WR", 30.1),
      player("Garrett Wilson", "WR", 30.8),
    ],
  });

  const flowers = buildDraftFitProfile({
    candidate: player("Zay Flowers", "WR", 30.1),
    sage: sage("consider-now"),
    myRoster,
    lineup: standardLineup(),
    nextTurnPool: [
      player("Garrett Wilson", "WR", 30.8),
    ],
  });

  assert.strictEqual(
    jeanty.diagnostics.fillsDedicated,
    true,
    "Jeanty should still be able to fill RB2"
  );

  assert.strictEqual(
    flowers.diagnostics.fillsDedicated,
    true,
    "Flowers should fill an open WR starting slot"
  );

  assert.ok(
    jeanty.fit,
    "Jeanty must remain in the decision set"
  );

  assert.ok(
    flowers.fit,
    "Flowers must remain in the decision set"
  );
});

// ============================================================
// SCENARIO 2
// Bowers rostered, McBride available.
//
// TE is filled, but FLEX remains open.
// McBride must remain a valid starting-lineup option.
// ============================================================

test("Scenario 2: second elite TE remains startable through FLEX", () => {
  const result = buildDraftFitProfile({
    candidate: player("Trey McBride", "TE", 20.8),
    sage: sage("take-now"),

    myRoster: [
      player("Brock Bowers", "TE", 18),
    ],

    lineup: standardLineup(),

    nextTurnPool: [],
  });

  assert.strictEqual(
    result.diagnostics.fillsDedicated,
    false
  );

  assert.strictEqual(
    result.diagnostics.fillsFlex,
    true
  );

  assert.strictEqual(
    result.diagnostics.wouldBeDepth,
    false
  );

  assert.strictEqual(
    result.fit,
    FIT.GOOD
  );

  assert.strictEqual(
    result.action,
    ACTION.HOLD
  );
});

// ============================================================
// SCENARIO 3
// RB-heavy roster with WR exposure.
//
// An ordinary depth RB should feel roster pressure.
// ============================================================

test("Scenario 3: comparable depth RB receives pressure when WR remains exposed", () => {
  const result = buildDraftFitProfile({
    candidate: player("Comparable RB", "RB", 38),
    sage: sage("consider-now"),

    myRoster: [
      player("James Cook III", "RB", 20),
      player("Jonathan Taylor", "RB", 13),
      player("Ashton Jeanty", "RB", 17),
      player("Brock Bowers", "TE", 18),
    ],

    lineup: standardLineup(),

    nextTurnPool: [
      player("RB Depth", "RB", 45),
    ],
  });

  assert.strictEqual(
    result.diagnostics.wouldBeDepth,
    true
  );

  assert.strictEqual(
    result.fit,
    FIT.PRESSURE
  );

  assert.strictEqual(
    result.action,
    ACTION.PRESSURE
  );
});

// ============================================================
// SCENARIO 4
// Same roster imbalance, but candidate has exceptional SAGE value.
//
// Draft Fit must preserve the ability to override roster pressure.
// ============================================================

test("Scenario 4: exceptional player value can override roster imbalance", () => {
  const result = buildDraftFitProfile({
    candidate: player("Exceptional Falling RB", "RB", 8),
    sage: sage("take-now"),

    myRoster: [
      player("James Cook III", "RB", 20),
      player("Jonathan Taylor", "RB", 13),
      player("Ashton Jeanty", "RB", 17),
      player("Brock Bowers", "TE", 18),
    ],

    lineup: standardLineup(),

    nextTurnPool: [
      player("Zay Flowers", "WR", 30.1),
      player("Garrett Wilson", "WR", 30.8),
    ],
  });

  assert.strictEqual(
    result.diagnostics.wouldBeDepth,
    true
  );

  assert.strictEqual(
    result.fit,
    FIT.VALUE_OVERRIDE
  );

  assert.strictEqual(
    result.action,
    ACTION.VALUE_OVERRIDE
  );
});

// ============================================================
// SCENARIO 5
// WR urgency rises when no viable WR projects to survive.
//
// This is the bridge between roster fit and future Draft Intelligence.
// ============================================================

test("Scenario 5: exposed WR position becomes Excellent Fit when next-turn WR depth disappears", () => {
  const result = buildDraftFitProfile({
    candidate: player("Zay Flowers", "WR", 30.1),
    sage: sage("consider-now"),

    myRoster: [
      player("James Cook III", "RB", 20),
      player("Brock Bowers", "TE", 18),
    ],

    lineup: standardLineup(),

    nextTurnPool: [
      player("RB Depth", "RB", 40),
      player("TE Depth", "TE", 42),
    ],
  });

  assert.strictEqual(
    result.fit,
    FIT.EXCELLENT
  );

  assert.strictEqual(
    result.action,
    ACTION.PROMOTE
  );

  assert.strictEqual(
    result.diagnostics.nextTurnDepth,
    false
  );
});

// ============================================================
// SCENARIO 6
// Guardrail for current V1.
//
// leagueSize and scoring may be passed through by future orchestration,
// but Draft Fit V1 does not currently consume them.
//
// The same football situation must therefore remain deterministic.
// ============================================================

test("Scenario 6: unused leagueSize and scoring fields do not silently alter Draft Fit V1", () => {
  const base = {
    candidate: player("Zay Flowers", "WR", 30.1),
    sage: sage("consider-now"),

    myRoster: [
      player("James Cook III", "RB", 20),
      player("Brock Bowers", "TE", 18),
    ],

    lineup: standardLineup(),

    nextTurnPool: [
      player("Garrett Wilson", "WR", 30.8),
    ],
  };

  const ppr12 = buildDraftFitProfile({
    ...base,
    scoring: "PPR",
    leagueSize: 12,
  });

  const standard8 = buildDraftFitProfile({
    ...base,
    scoring: "STANDARD",
    leagueSize: 8,
  });

  assert.strictEqual(
    ppr12.fit,
    standard8.fit
  );

  assert.strictEqual(
    ppr12.action,
    standard8.action
  );

  assert.strictEqual(
    ppr12.explanation,
    standard8.explanation
  );
});

console.log("");
console.log(
  `draft-intelligence-scenarios.test.js: ${passed}/${passed + failed} passed`
);

if (failed > 0) {
  process.exitCode = 1;
}
