"use strict";

const assert = require("assert");
const {
  buildFootballReasoningPacket,
  footballReasoningPacketToText
} = require("../netlify/functions/_sage-football-reasoning");

const motion = buildFootballReasoningPacket(
  "How can a motion-heavy Z receiver use safety alignment and defensive response to understand coverage?"
);

assert.strictEqual(motion.canChangeProductionRanking, false);
assert.ok(motion.establishedKnowledge.length > 0, "expected established football knowledge");
assert.ok(
  motion.practitionerEvidence.some((item) => /Z\/slot|motion/i.test(item.title + " " + item.summary)),
  "expected Pat's Z/slot experience note to remain separately identified"
);
assert.ok(
  motion.reasoningRules.some((rule) => /current.*evidence/i.test(rule)),
  "must require current evidence for current matchup claims"
);

const matchup = buildFootballReasoningPacket(
  "offense defense scheme interaction improves fantasy matchup evaluation"
);
assert.ok(matchup.researchHypotheses.length > 0, "expected scheme/fantasy hypothesis");
assert.ok(
  matchup.researchHypotheses.every((item) => item.productionUse === "research-only"),
  "hypotheses must remain research-only"
);

const coryell = buildFootballReasoningPacket("What did Don Coryell contribute to passing offense?");
assert.ok(coryell.establishedKnowledge.some((item) => /Coryell/i.test(item.title + " " + item.summary)));
assert.ok(coryell.provenance.length > 0, "reasoning packet must preserve provenance");

const text = footballReasoningPacketToText(matchup);
assert.ok(text.includes("Research hypotheses (not facts):"));
assert.ok(text.includes("Production ranking impact: NONE"));

console.log("Super SAGE football reasoning bridge assertions passed.");
