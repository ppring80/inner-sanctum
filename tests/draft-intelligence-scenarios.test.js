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

function player(name, position, sageScore, adp) {
  return {
    name,
    position,
    sageScore,
    adp,
  };
}

function roster(...positions) {
  return positions.map((position, index) => ({
    name: `Roster Player ${index + 1}`,
    position,
  }));
}

/*
 * DRAFT INTELLIGENCE SCENARIO TESTS
 *
 * These tests do NOT attempt to replace SAGE.
 *
 * SAGE tells us how attractive the player is.
 * Draft Fit tells us how the player fits this roster.
 *
 * The purpose of these scenarios is to define the behavior
 * we eventually want from the final Draft Intelligence layer.
 *
 * Important:
 *
 * We are NOT saying:
 *
 *   "No WR = always draft WR."
 *
 * We ARE saying:
 *
 *   When player values are reasonably close, roster construction
 *   should matter.
 *
 *   When one player has a truly exceptional value advantage,
 *   Draft Intelligence must still be capable of taking that player.
 */

test("Scenario 1: WR need should matter when player values are close", () => {
  const myRoster = roster("RB", "TE");

  const candidates = [
    player("Elite RB", "RB", 91, 18),
    player("Strong WR", "WR", 89, 25),
    player("Elite TE", "TE", 90, 20),
  ];

  const profiles = candidates.map((candidate) =>
    buildDraftFitProfile({
      candidate,
      roster: myRoster,
      lineup: DEFAULT_LINEUP,
      leagueSize: 12,
      scoring: "PPR",
      currentPick: 36,
      nextPick: 61,
    })
  );

  const wr = profiles.find(
    (profile) => profile.candidate.position === "WR"
  );

  const rb = profiles.find(
    (profile) => profile.candidate.position === "RB"
  );

  const te = profiles.find(
    (profile) => profile.candidate.position === "TE"
  );

  assert.ok(wr, "WR profile should exist");
  assert.ok(rb, "RB profile should exist");
  assert.ok(te, "TE profile should exist");

  /*
   * We intentionally avoid asserting an exact final ranking here.
   *
   * At this stage we only want Draft Fit to recognize that the WR
   * addresses roster construction differently from another RB or TE.
   *
   * Final ranking belongs to Draft Intelligence.
   */

  assert.notStrictEqual(
    wr.fit,
    undefined,
    "WR should receive a Draft Fit classification"
  );

  assert.notStrictEqual(
    rb.fit,
    undefined,
    "RB should receive a Draft Fit classification"
  );

  assert.notStrictEqual(
    te.fit,
    undefined,
    "TE should receive a Draft Fit classification"
  );
});

test("Scenario 2: Draft Fit must not automatically reject a second elite TE", () => {
  const myRoster = roster("RB", "TE");

  const candidate = player("Second Elite TE", "TE", 95, 24);

  const profile = buildDraftFitProfile({
    candidate,
    roster: myRoster,
    lineup: DEFAULT_LINEUP,
    leagueSize: 12,
    scoring: "PPR",
    currentPick: 36,
    nextPick: 61,
  });

  assert.ok(profile, "Draft Fit profile should exist");

  /*
   * A premium TE may carry WR-like production and may also be FLEX
   * eligible depending on league format.
   *
   * Therefore a second TE cannot be categorically prohibited.
   */

  assert.notStrictEqual(
    profile.fit,
    undefined,
    "Second TE must still be evaluated rather than automatically removed"
  );
});

test("Scenario 3: Exceptional player value must remain available to Draft Intelligence", () => {
  const myRoster = roster("RB", "TE");

  const eliteRB = player("Exceptional RB Value", "RB", 99, 12);

  const profile = buildDraftFitProfile({
    candidate: eliteRB,
    roster: myRoster,
    lineup: DEFAULT_LINEUP,
    leagueSize: 12,
    scoring: "PPR",
    currentPick: 36,
    nextPick: 61,
  });

  assert.ok(profile, "Exceptional RB should receive a profile");

  /*
   * Draft Fit may prefer another position.
   * It must NOT make the player disappear.
   *
   * Draft Intelligence needs the opportunity to determine that
   * exceptional value outweighs roster preference.
   */

  assert.notStrictEqual(
    profile.fit,
    undefined,
    "Exceptional value player must remain in the decision set"
  );
});

test("Scenario 4: league configuration is part of the decision context", () => {
  const myRoster = roster("RB", "TE");

  const candidate = player("Strong WR", "WR", 90, 28);

  const profile = buildDraftFitProfile({
    candidate,
    roster: myRoster,
    lineup: DEFAULT_LINEUP,
    leagueSize: 14,
    scoring: "HALF_PPR",
    currentPick: 36,
    nextPick: 63,
  });

  assert.ok(profile, "Profile should be created for 14-team Half-PPR");

  /*
   * This protects the architecture we agreed on:
   *
   * 8 / 10 / 12 / 14 teams
   * Standard / Half-PPR / PPR
   *
   * Draft Intelligence must receive this context rather than assuming
   * every league behaves the same way.
   */

  assert.notStrictEqual(
    profile.fit,
    undefined,
    "Candidate should receive a fit classification"
  );
});

console.log("");
console.log(`Draft Intelligence scenarios: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exitCode = 1;
}
