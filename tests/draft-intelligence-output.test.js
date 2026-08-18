// tests/draft-intelligence-output.test.js

"use strict";

const assert = require("assert");

const {
  evaluateDraftIntelligence,
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
  explanation,
  reasons = []
) {
  return {
    fit,
    action,
    label,
    explanation,
    reasons,
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
  fitReasons,
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
      fitExplanation,
      fitReasons
    ),
  };
}

// ============================================================
// CONTRACT 1
// Player identity must be preserved.
// ============================================================

test("output preserves player identity and ADP", () => {
  const result = evaluateDraftIntelligence(
    entry({
      name: "Zay Flowers",
      pos: "WR",
      adp: 30.1,
      team: "BAL",
      sageCode: "consider-now",
      sageLabel: "Consider Now",
      fit: "excellent-fit",
      action: "promote",
      fitLabel: "Excellent Fit",
      fitExplanation:
        "Fills WR1 before comparable WR depth disappears.",
    }),
    {
      currentPick: 27,
      nextUserPick: 36,
      nextTurnPool: [],
    }
  );

  assert.deepStrictEqual(
    result.player,
    {
      name: "Zay Flowers",
      pos: "WR",
      team: "BAL",
    }
  );

  assert.strictEqual(
    result.adp,
    30.1
  );
});

// ============================================================
// CONTRACT 2
// Original SAGE recommendation must remain visible and unchanged.
// ============================================================

test("output preserves original SAGE recommendation separately from final decision", () => {
  const result = evaluateDraftIntelligence(
    entry({
      name: "Zay Flowers",
      pos: "WR",
      adp: 30.1,
      team: "BAL",
      sageCode: "consider-now",
      sageLabel: "Consider Now",
      fit: "excellent-fit",
      action: "promote",
      fitLabel: "Excellent Fit",
      fitExplanation:
        "Fills WR1 before comparable WR depth disappears.",
    }),
    {
      currentPick: 27,
      nextUserPick: 36,
      nextTurnPool: [],
    }
  );

  assert.strictEqual(
    result.sage.code,
    "consider-now"
  );

  assert.strictEqual(
    result.sage.recommendation,
    "Consider Now"
  );

  assert.strictEqual(
    result.decision.code,
    "strong-consideration"
  );

  assert.strictEqual(
    result.decision.recommendation,
    "Strong Consideration"
  );
});

// ============================================================
// CONTRACT 3
// Draft Fit must remain categorical and explainable.
// ============================================================

test("output preserves Draft Fit category, action, explanation, and reasons", () => {
  const result = evaluateDraftIntelligence(
    entry({
      name: "Ashton Jeanty",
      pos: "RB",
      adp: 16.9,
      team: "LV",
      sageCode: "take-now",
      sageLabel: "Take Now",
      fit: "good-fit",
      action: "hold",
      fitLabel: "Good Fit",
      fitExplanation:
        "Adds a premium starting RB.",
      fitReasons: [
        "fills an open starting RB slot",
      ],
    }),
    {
      currentPick: 24,
      nextUserPick: 36,
      nextTurnPool: [
        candidate(
          "Ashton Jeanty",
          "RB",
          16.9,
          "LV"
        ),
      ],
    }
  );

  assert.strictEqual(
    result.draftFit.fit,
    "good-fit"
  );

  assert.strictEqual(
    result.draftFit.label,
    "Good Fit"
  );

  assert.strictEqual(
    result.draftFit.action,
    "hold"
  );

  assert.strictEqual(
    result.draftFit.explanation,
    "Adds a premium starting RB."
  );

  assert.deepStrictEqual(
    result.draftFit.reasons,
    [
      "fills an open starting RB slot",
    ]
  );
});

// ============================================================
// CONTRACT 4
// Waiting risk must be visible to the consumer layer.
// ============================================================

test("output exposes waiting-risk level and explanation", () => {
  const result = evaluateDraftIntelligence(
    entry({
      name: "Garrett Wilson",
      pos: "WR",
      adp: 30.8,
      team: "NYJ",
      sageCode: "consider-now",
      sageLabel: "Consider Now",
      fit: "excellent-fit",
      action: "promote",
      fitLabel: "Excellent Fit",
      fitExplanation:
        "Fills an open WR starting slot.",
    }),
    {
      currentPick: 27,
      nextUserPick: 36,

      nextTurnPool: [
        candidate(
          "RB Alternative",
          "RB",
          38
        ),
      ],
    }
  );

  assert.strictEqual(
    result.waitingRisk.level,
    "high"
  );

  assert.ok(
    typeof result.waitingRisk.reason === "string" &&
    result.waitingRisk.reason.length > 0
  );
});

// ============================================================
// CONTRACT 5
// Final decision must include code, label, adjustment, explanation.
// ============================================================

test("final decision contract is complete and explainable", () => {
  const result = evaluateDraftIntelligence(
    entry({
      name: "Zay Flowers",
      pos: "WR",
      adp: 30.1,
      team: "BAL",
      sageCode: "consider-now",
      sageLabel: "Consider Now",
      fit: "excellent-fit",
      action: "promote",
      fitLabel: "Excellent Fit",
      fitExplanation:
        "Fills WR1 before comparable WR depth disappears.",
    }),
    {
      currentPick: 27,
      nextUserPick: 36,
      nextTurnPool: [],
    }
  );

  assert.strictEqual(
    result.decision.code,
    "strong-consideration"
  );

  assert.strictEqual(
    result.decision.recommendation,
    "Strong Consideration"
  );

  assert.strictEqual(
    result.decision.adjustment,
    "promoted-one-tier"
  );

  assert.ok(
    typeof result.decision.explanation === "string" &&
    result.decision.explanation.length > 0
  );
});

// ============================================================
// CONTRACT 6
// Value Override must remain visible and preserve the SAGE tier.
// ============================================================

test("Value Override is explicit in the output contract", () => {
  const result = evaluateDraftIntelligence(
    entry({
      name: "Exceptional RB",
      pos: "RB",
      adp: 12,
      team: "IND",
      sageCode: "take-now",
      sageLabel: "Take Now",
      fit: "value-override",
      action: "value-override",
      fitLabel: "Value Override",
      fitExplanation:
        "The value is too strong to pass despite temporary imbalance.",
    }),
    {
      currentPick: 24,
      nextUserPick: 36,
      nextTurnPool: [],
    }
  );

  assert.strictEqual(
    result.sage.code,
    "take-now"
  );

  assert.strictEqual(
    result.decision.code,
    "take-now"
  );

  assert.strictEqual(
    result.decision.adjustment,
    "value-override"
  );

  assert.strictEqual(
    result.draftFit.fit,
    "value-override"
  );
});

// ============================================================
// CONTRACT 7
// Roster pressure must remain visible without erasing player value.
// ============================================================

test("Roster Pressure remains visible while final recommendation is restrained one tier", () => {
  const result = evaluateDraftIntelligence(
    entry({
      name: "Fourth RB",
      pos: "RB",
      adp: 22,
      team: "CIN",
      sageCode: "take-now",
      sageLabel: "Take Now",
      fit: "roster-pressure",
      action: "pressure",
      fitLabel: "Roster Pressure",
      fitExplanation:
        "Another RB would add depth while WR remains unfilled.",
    }),
    {
      currentPick: 30,
      nextUserPick: 36,
      nextTurnPool: [],
    }
  );

  assert.strictEqual(
    result.sage.code,
    "take-now"
  );

  assert.strictEqual(
    result.draftFit.fit,
    "roster-pressure"
  );

  assert.strictEqual(
    result.decision.code,
    "strong-consideration"
  );

  assert.strictEqual(
    result.decision.adjustment,
    "restrained-one-tier"
  );
});

// ============================================================
// CONTRACT 8
// Diagnostics needed for deterministic ordering remain present.
// These do not need to be displayed in the UI.
// ============================================================

test("output contains deterministic ranking diagnostics", () => {
  const result = evaluateDraftIntelligence(
    entry({
      name: "Player A",
      pos: "WR",
      adp: 28,
      sageCode: "take-now",
      sageLabel: "Take Now",
      fit: "good-fit",
      action: "hold",
      fitLabel: "Good Fit",
      fitExplanation:
        "Adds a starting WR.",
    }),
    {
      currentPick: 24,
      nextUserPick: 36,
      nextTurnPool: [],
    }
  );

  assert.ok(
    Number.isInteger(
      result.diagnostics.sageRank
    )
  );

  assert.ok(
    Number.isInteger(
      result.diagnostics.decisionRank
    )
  );

  assert.ok(
    Number.isInteger(
      result.diagnostics.fitPriority
    )
  );
});

// ============================================================
// CONTRACT 9
// Final Top 5 payload.
// ============================================================

test("Top 5 recommendation payload contains required consumer fields", () => {
  const candidates = [
    entry({
      name: "Player A",
      pos: "RB",
      adp: 10,
      team: "AAA",
      sageCode: "take-now",
      sageLabel: "Take Now",
      fit: "good-fit",
      action: "hold",
      fitLabel: "Good Fit",
      fitExplanation:
        "Adds a starting RB.",
    }),

    entry({
      name: "Player B",
      pos: "WR",
      adp: 12,
      team: "BBB",
      sageCode: "take-now",
      sageLabel: "Take Now",
      fit: "excellent-fit",
      action: "promote",
      fitLabel: "Excellent Fit",
      fitExplanation:
        "Fills an exposed WR slot.",
    }),

    entry({
      name: "Player C",
      pos: "TE",
      adp: 15,
      team: "CCC",
      sageCode: "strong-consideration",
      sageLabel: "Strong Consideration",
      fit: "good-fit",
      action: "hold",
      fitLabel: "Good Fit",
      fitExplanation:
        "Can start through FLEX.",
    }),

    entry({
      name: "Player D",
      pos: "WR",
      adp: 18,
      team: "DDD",
      sageCode: "consider-now",
      sageLabel: "Consider Now",
      fit: "excellent-fit",
      action: "promote",
      fitLabel: "Excellent Fit",
      fitExplanation:
        "Addresses WR exposure.",
    }),

    entry({
      name: "Player E",
      pos: "RB",
      adp: 20,
      team: "EEE",
      sageCode: "consider-now",
      sageLabel: "Consider Now",
      fit: "neutral-fit",
      action: "hold",
      fitLabel: "Neutral Fit",
    }),

    entry({
      name: "Player F",
      pos: "QB",
      adp: 24,
      team: "FFF",
      sageCode: "consider",
      sageLabel: "Consider",
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
      nextTurnPool: [],
    },
    5
  );

  assert.strictEqual(
    top.length,
    5
  );

  top.forEach(
    (recommendation, index) => {
      assert.strictEqual(
        recommendation.rank,
        index + 1
      );

      assert.ok(
        recommendation.player &&
        recommendation.player.name
      );

      assert.ok(
        recommendation.decision &&
        recommendation.decision.code
      );

      assert.ok(
        recommendation.sage &&
        recommendation.sage.code
      );

      assert.ok(
        recommendation.draftFit &&
        recommendation.draftFit.fit
      );

      assert.ok(
        recommendation.waitingRisk &&
        recommendation.waitingRisk.level
      );

      assert.ok(
        typeof recommendation.decision.explanation === "string"
      );
    }
  );
});

// ============================================================
// CONTRACT 10
// No hidden numeric Draft Fit score should appear.
// ============================================================

test("consumer output does not invent a hidden Draft Fit numeric score", () => {
  const result = evaluateDraftIntelligence(
    entry({
      name: "Brock Bowers",
      pos: "TE",
      adp: 18,
      team: "LV",
      sageCode: "take-now",
      sageLabel: "Take Now",
      fit: "good-fit",
      action: "hold",
      fitLabel: "Good Fit",
      fitExplanation:
        "Adds premium lineup utility.",
    }),
    {
      currentPick: 12,
      nextUserPick: 25,
      nextTurnPool: [],
    }
  );

  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(
      result.draftFit,
      "score"
    ),
    false
  );

  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(
      result,
      "draftFitScore"
    ),
    false
  );

  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(
      result,
      "intelligenceScore"
    ),
    false
  );
});

// ============================================================
// Summary
// ============================================================

console.log("");
console.log(
  `draft-intelligence-output.test.js: ${passed}/${passed + failed} passed`
);

if (failed > 0) {
  process.exitCode = 1;
}
