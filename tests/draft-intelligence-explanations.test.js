// tests/draft-intelligence-explanations.test.js

"use strict";

const assert = require("assert");

const {
  evaluateDraftIntelligence,
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
// EXPLANATION 1
// Promoted recommendation should clearly explain that roster fit
// plus waiting risk strengthened the decision.
// ============================================================

test("promoted recommendation explains fit plus waiting risk", () => {
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
    result.decision.adjustment,
    "promoted-one-tier"
  );

  assert.ok(
    result.decision.explanation.includes(
      "Excellent Fit"
    )
  );

  assert.ok(
    result.decision.explanation.toLowerCase().includes(
      "next"
    )
  );
});

// ============================================================
// EXPLANATION 2
// Roster Pressure should not sound like the player is bad.
// It should explicitly say the player remains attractive.
// ============================================================

test("Roster Pressure explanation preserves player quality", () => {
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
    result.decision.adjustment,
    "restrained-one-tier"
  );

  assert.ok(
    result.decision.explanation.toLowerCase().includes(
      "remains attractive"
    )
  );

  assert.ok(
    result.decision.explanation.toLowerCase().includes(
      "roster"
    )
  );
});

// ============================================================
// EXPLANATION 3
// Value Override should make clear that roster imbalance exists,
// but strong player value wins.
// ============================================================

test("Value Override explanation states value beats temporary imbalance", () => {
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
    result.decision.adjustment,
    "value-override"
  );

  assert.ok(
    result.decision.explanation.toLowerCase().includes(
      "strong enough"
    )
  );

  assert.ok(
    result.decision.explanation.toLowerCase().includes(
      "imbalance"
    )
  );
});

// ============================================================
// EXPLANATION 4
// Neutral/Good Fit should not manufacture urgency.
// ============================================================

test("Hold explanation remains calm when Draft Fit does not change the decision", () => {
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
    result.decision.adjustment,
    "none"
  );

  assert.ok(
    result.decision.explanation.includes(
      "Good Fit"
    )
  );

  assert.ok(
    result.decision.explanation.includes(
      "Adds a premium starting RB."
    )
  );
});

// ============================================================
// EXPLANATION 5
// Consumer explanation should be concise.
// ============================================================

test("decision explanation remains concise enough for recommendation cards", () => {
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

  assert.ok(
    result.decision.explanation.length <= 220,
    `Explanation is too long: ${result.decision.explanation.length} characters`
  );
});

// ============================================================
// EXPLANATION 6
// Explanation must not expose implementation internals.
// ============================================================

test("consumer explanation does not expose internal ranking terminology", () => {
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

  const text =
    result.decision.explanation.toLowerCase();

  assert.strictEqual(
    text.includes("tier"),
    false
  );

  assert.strictEqual(
    text.includes("rank"),
    false
  );

  assert.strictEqual(
    text.includes("fitpriority"),
    false
  );

  assert.strictEqual(
    text.includes("diagnostics"),
    false
  );
});

// ============================================================
// EXPLANATION 7
// Explanation must be deterministic for the same input.
// ============================================================

test("same decision input produces the same explanation", () => {
  const input = entry({
    name: "Trey McBride",
    pos: "TE",
    adp: 20.8,
    team: "ARI",
    sageCode: "take-now",
    sageLabel: "Take Now",
    fit: "good-fit",
    action: "hold",
    fitLabel: "Good Fit",
    fitExplanation:
      "TE is filled, but this player can still start through FLEX.",
  });

  const context = {
    currentPick: 24,
    nextUserPick: 36,

    nextTurnPool: [
      candidate(
        "Trey McBride",
        "TE",
        20.8,
        "ARI"
      ),
    ],
  };

  const first =
    evaluateDraftIntelligence(
      input,
      context
    );

  const second =
    evaluateDraftIntelligence(
      input,
      context
    );

  assert.strictEqual(
    first.decision.explanation,
    second.decision.explanation
  );
});

// ============================================================
// EXPLANATION 8
// Existing SAGE and Draft Fit explanations remain separately
// available even when Draft Intelligence creates its own summary.
// ============================================================

test("consumer payload preserves all three explanation layers", () => {
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
      fitReasons: [
        "fills an open starting WR slot",
        "WR options are projected to thin before the next turn",
      ],
    }),
    {
      currentPick: 27,
      nextUserPick: 36,
      nextTurnPool: [],
    }
  );

  assert.strictEqual(
    result.sage.recommendation,
    "Consider Now"
  );

  assert.strictEqual(
    result.draftFit.explanation,
    "Fills WR1 before comparable WR depth disappears."
  );

  assert.ok(
    result.decision.explanation
  );

  assert.notStrictEqual(
    result.decision.explanation,
    result.draftFit.explanation
  );
});

// ============================================================
// Summary
// ============================================================

console.log("");
console.log(
  `draft-intelligence-explanations.test.js: ${passed}/${passed + failed} passed`
);

if (failed > 0) {
  process.exitCode = 1;
}
