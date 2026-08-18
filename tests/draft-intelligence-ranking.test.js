// tests/draft-intelligence-ranking.test.js

"use strict";

const assert = require("assert");

const {
  rankDraftIntelligence,
  buildTopDraftRecommendations,
} = require("../netlify/functions/draft-intelligence");

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

function candidate(name, pos, adp, team = "") {
  return {
    name,
    pos,
    adp,
    team,
  };
}

function sage(code, recommendation) {
  return {
    code,
    recommendation: recommendation || code,
  };
}

function draftFit(
  fit,
  action,
  label,
  explanation
) {
  return {
    fit,
    action,
    label,
    explanation: explanation || "",
    reasons: [],
  };
}

function entry({
  name,
  pos,
  adp,
  team,
  sageCode,
  sageLabel,
  fit,
  action,
  fitLabel,
  fitExplanation,
}) {
  return {
    candidate: candidate(
      name,
      pos,
      adp,
      team
    ),

    sage: sage(
      sageCode,
      sageLabel
    ),

    draftFit: draftFit(
      fit,
      action,
      fitLabel,
      fitExplanation
    ),
  };
}

// ============================================================
// SCENARIO 1
// Same SAGE tier:
// Draft Fit should break the tie.
//
// This is the cleanest possible proof that the final layer is
// personalized without rewriting SAGE.
// ============================================================

test("same SAGE tier: Excellent Fit ranks ahead of Neutral Fit", () => {
  const candidates = [
    entry({
      name: "Neutral RB",
      pos: "RB",
      adp: 30,
      sageCode: "take-now",
      sageLabel: "Take Now",
      fit: "neutral-fit",
      action: "hold",
      fitLabel: "Neutral Fit",
    }),

    entry({
      name: "Excellent WR",
      pos: "WR",
      adp: 32,
      sageCode: "take-now",
      sageLabel: "Take Now",
      fit: "excellent-fit",
      action: "promote",
      fitLabel: "Excellent Fit",
    }),
  ];

  const ranked = rankDraftIntelligence(
    candidates,
    {
      currentPick: 24,
      nextUserPick: 36,

      nextTurnPool: [
        candidate("Neutral RB", "RB", 30),
      ],
    }
  );

  assert.strictEqual(
    ranked[0].player.name,
    "Excellent WR"
  );

  assert.strictEqual(
    ranked[0].decision.code,
    "take-now"
  );
});

// ============================================================
// SCENARIO 2
// WR need matters when SAGE evaluations are close.
//
// A Consider Now WR with Excellent Fit and real waiting risk
// may rise one tier to Strong Consideration.
//
// That should allow him to compete with a Strong Consideration
// depth player.
// ============================================================

test("close SAGE choices: exposed WR can rise when waiting risk is meaningful", () => {
  const candidates = [
    entry({
      name: "Depth RB",
      pos: "RB",
      adp: 34,
      sageCode: "strong-consideration",
      sageLabel: "Strong Consideration",
      fit: "roster-pressure",
      action: "pressure",
      fitLabel: "Roster Pressure",
      fitExplanation:
        "RB would add depth while WR remains exposed.",
    }),

    entry({
      name: "Starting WR",
      pos: "WR",
      adp: 30,
      sageCode: "consider-now",
      sageLabel: "Consider Now",
      fit: "excellent-fit",
      action: "promote",
      fitLabel: "Excellent Fit",
      fitExplanation:
        "Fills WR1 before the position thins.",
    }),
  ];

  const ranked = rankDraftIntelligence(
    candidates,
    {
      currentPick: 27,
      nextUserPick: 36,

      nextTurnPool: [
        candidate("RB Alternative", "RB", 38),
      ],
    }
  );

  assert.strictEqual(
    ranked[0].player.name,
    "Starting WR"
  );

  assert.strictEqual(
    ranked[0].decision.code,
    "strong-consideration"
  );

  assert.strictEqual(
    ranked[0].decision.adjustment,
    "promoted-one-tier"
  );
});

// ============================================================
// SCENARIO 3
// Exceptional value protection.
//
// Draft Fit may identify roster imbalance, but Value Override
// must preserve the underlying elite SAGE recommendation.
// ============================================================

test("Value Override preserves elite SAGE value despite roster imbalance", () => {
  const candidates = [
    entry({
      name: "Exceptional RB",
      pos: "RB",
      adp: 12,
      sageCode: "take-now",
      sageLabel: "Take Now",
      fit: "value-override",
      action: "value-override",
      fitLabel: "Value Override",
      fitExplanation:
        "The value is too strong to pass despite temporary imbalance.",
    }),

    entry({
      name: "Good WR",
      pos: "WR",
      adp: 29,
      sageCode: "consider-now",
      sageLabel: "Consider Now",
      fit: "excellent-fit",
      action: "promote",
      fitLabel: "Excellent Fit",
      fitExplanation:
        "Fills WR1.",
    }),
  ];

  const ranked = rankDraftIntelligence(
    candidates,
    {
      currentPick: 24,
      nextUserPick: 36,

      nextTurnPool: [],
    }
  );

  assert.strictEqual(
    ranked[0].player.name,
    "Exceptional RB"
  );

  assert.strictEqual(
    ranked[0].decision.code,
    "take-now"
  );

  assert.strictEqual(
    ranked[0].decision.adjustment,
    "value-override"
  );
});

// ============================================================
// SCENARIO 4
// Roster pressure restrains but does not destroy a strong player.
//
// A TAKE NOW depth candidate can be restrained one tier.
// It must not collapse several tiers.
// ============================================================

test("Roster Pressure restrains a Take Now player by only one tier", () => {
  const candidates = [
    entry({
      name: "Fourth RB",
      pos: "RB",
      adp: 22,
      sageCode: "take-now",
      sageLabel: "Take Now",
      fit: "roster-pressure",
      action: "pressure",
      fitLabel: "Roster Pressure",
      fitExplanation:
        "Another RB would add depth while WR remains unfilled.",
    }),
  ];

  const ranked = rankDraftIntelligence(
    candidates,
    {
      currentPick: 30,
      nextUserPick: 36,
      nextTurnPool: [],
    }
  );

  assert.strictEqual(
    ranked[0].decision.code,
    "strong-consideration"
  );

  assert.strictEqual(
    ranked[0].decision.adjustment,
    "restrained-one-tier"
  );
});

// ============================================================
// SCENARIO 5
// A weak player cannot become elite just because the roster needs
// his position.
//
// Excellent Fit may only move one SAGE tier.
// ============================================================

test("roster need cannot turn a weak SAGE player into Take Now", () => {
  const candidates = [
    entry({
      name: "Needed WR",
      pos: "WR",
      adp: 60,
      sageCode: "consider",
      sageLabel: "Consider",
      fit: "excellent-fit",
      action: "promote",
      fitLabel: "Excellent Fit",
      fitExplanation:
        "Fills an exposed WR starting slot.",
    }),
  ];

  const ranked = rankDraftIntelligence(
    candidates,
    {
      currentPick: 48,
      nextUserPick: 61,
      nextTurnPool: [],
    }
  );

  assert.strictEqual(
    ranked[0].decision.code,
    "consider-now"
  );

  assert.notStrictEqual(
    ranked[0].decision.code,
    "take-now"
  );
});

// ============================================================
// SCENARIO 6
// Second elite TE protection.
//
// With FLEX utility, a second TE classified as Good Fit should
// remain a legitimate recommendation rather than being punished
// merely for positional duplication.
// ============================================================

test("second elite TE remains viable when Draft Fit says Good Fit", () => {
  const candidates = [
    entry({
      name: "Elite TE Two",
      pos: "TE",
      adp: 21,
      sageCode: "take-now",
      sageLabel: "Take Now",
      fit: "good-fit",
      action: "hold",
      fitLabel: "Good Fit",
      fitExplanation:
        "TE is filled, but this player can start through FLEX.",
    }),

    entry({
      name: "Ordinary WR",
      pos: "WR",
      adp: 31,
      sageCode: "consider",
      sageLabel: "Consider",
      fit: "excellent-fit",
      action: "promote",
      fitLabel: "Excellent Fit",
      fitExplanation:
        "Fills an open WR slot.",
    }),
  ];

  const ranked = rankDraftIntelligence(
    candidates,
    {
      currentPick: 24,
      nextUserPick: 36,

      nextTurnPool: [
        candidate("Ordinary WR", "WR", 31),
      ],
    }
  );

  assert.strictEqual(
    ranked[0].player.name,
    "Elite TE Two"
  );

  assert.strictEqual(
    ranked[0].decision.code,
    "take-now"
  );
});

// ============================================================
// SCENARIO 7
// ADP remains the final objective tie-breaker.
//
// Same final decision.
// Same Draft Fit.
// Same original SAGE tier.
// Lower ADP should rank first.
// ============================================================

test("ADP breaks a complete Draft Intelligence tie", () => {
  const candidates = [
    entry({
      name: "Player B",
      pos: "WR",
      adp: 33,
      sageCode: "take-now",
      sageLabel: "Take Now",
      fit: "good-fit",
      action: "hold",
      fitLabel: "Good Fit",
    }),

    entry({
      name: "Player A",
      pos: "WR",
      adp: 28,
      sageCode: "take-now",
      sageLabel: "Take Now",
      fit: "good-fit",
      action: "hold",
      fitLabel: "Good Fit",
    }),
  ];

  const ranked = rankDraftIntelligence(
    candidates,
    {
      currentPick: 24,
      nextUserPick: 36,

      nextTurnPool: [
        candidate("Player A", "WR", 28),
        candidate("Player B", "WR", 33),
      ],
    }
  );

  assert.strictEqual(
    ranked[0].player.name,
    "Player A"
  );
});

// ============================================================
// SCENARIO 8
// Top 5 contract.
//
// Draft Intelligence should deterministically return exactly five
// recommendations when more than five candidates exist.
// ============================================================

test("Top recommendation builder returns deterministic Top 5", () => {
  const candidates = [
    entry({
      name: "A",
      pos: "RB",
      adp: 10,
      sageCode: "take-now",
      fit: "good-fit",
      action: "hold",
      fitLabel: "Good Fit",
    }),

    entry({
      name: "B",
      pos: "WR",
      adp: 12,
      sageCode: "take-now",
      fit: "excellent-fit",
      action: "promote",
      fitLabel: "Excellent Fit",
    }),

    entry({
      name: "C",
      pos: "TE",
      adp: 15,
      sageCode: "strong-consideration",
      fit: "good-fit",
      action: "hold",
      fitLabel: "Good Fit",
    }),

    entry({
      name: "D",
      pos: "WR",
      adp: 18,
      sageCode: "consider-now",
      fit: "excellent-fit",
      action: "promote",
      fitLabel: "Excellent Fit",
    }),

    entry({
      name: "E",
      pos: "RB",
      adp: 20,
      sageCode: "consider-now",
      fit: "neutral-fit",
      action: "hold",
      fitLabel: "Neutral Fit",
    }),

    entry({
      name: "F",
      pos: "QB",
      adp: 24,
      sageCode: "consider",
      fit: "good-fit",
      action: "hold",
      fitLabel: "Good Fit",
    }),

    entry({
      name: "G",
      pos: "WR",
      adp: 27,
      sageCode: "consider",
      fit: "good-fit",
      action: "hold",
      fitLabel: "Good Fit",
    }),
  ];

  const top = buildTopDraftRecommendations(
    candidates,
    {
      currentPick: 10,
      nextUserPick: 24,

      nextTurnPool: [
        candidate("A", "RB", 10),
        candidate("F", "QB", 24),
        candidate("G", "WR", 27),
      ],
    },
    5
  );

  assert.strictEqual(
    top.length,
    5
  );

  assert.deepStrictEqual(
    top.map((item) => item.rank),
    [1, 2, 3, 4, 5]
  );
});

// ============================================================
// SCENARIO 9
// Our real conceptual Draft Command Center case.
//
// Cook + Bowers is handled by Draft Fit upstream.
// Here we simulate the resulting player states:
//
// Jeanty:
//   stronger underlying SAGE
//
// Flowers:
//   weaker SAGE but Excellent Fit and meaningful waiting risk
//
// Draft Intelligence must preserve both as meaningful options and
// explain why they differ.
// ============================================================

test("real draft concept: elite RB and roster-fit WR remain meaningfully differentiated", () => {
  const candidates = [
    entry({
      name: "Ashton Jeanty",
      pos: "RB",
      adp: 16.9,
      sageCode: "take-now",
      sageLabel: "Take Now",
      fit: "good-fit",
      action: "hold",
      fitLabel: "Good Fit",
      fitExplanation:
        "Adds a premium starting RB while WR remains the main roster exposure.",
    }),

    entry({
      name: "Zay Flowers",
      pos: "WR",
      adp: 30.1,
      sageCode: "consider-now",
      sageLabel: "Consider Now",
      fit: "excellent-fit",
      action: "promote",
      fitLabel: "Excellent Fit",
      fitExplanation:
        "Fills WR1 before comparable WR depth disappears.",
    }),
  ];

  const ranked = rankDraftIntelligence(
    candidates,
    {
      currentPick: 27,
      nextUserPick: 36,

      nextTurnPool: [
        candidate("RB Alternative", "RB", 35),
      ],
    }
  );

  const jeanty = ranked.find(
    (item) =>
      item.player.name === "Ashton Jeanty"
  );

  const flowers = ranked.find(
    (item) =>
      item.player.name === "Zay Flowers"
  );

  assert.ok(
    jeanty,
    "Jeanty should remain in the recommendation set"
  );

  assert.ok(
    flowers,
    "Flowers should remain in the recommendation set"
  );

  assert.strictEqual(
    jeanty.decision.code,
    "take-now"
  );

  assert.strictEqual(
    flowers.decision.code,
    "strong-consideration"
  );

  assert.strictEqual(
    flowers.decision.adjustment,
    "promoted-one-tier"
  );
});

// ============================================================
// Summary
// ============================================================

console.log("");
console.log(
  `draft-intelligence-ranking.test.js: ${passed}/${passed + failed} passed`
);

if (failed > 0) {
  process.exitCode = 1;
}
