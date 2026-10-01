"use strict";

const assert = require("assert");
const { loadKnowledge, retrieveFootballKnowledge } = require("../netlify/functions/_sage-football-knowledge");

const loaded = loadKnowledge();
assert.ok(loaded.entries.length >= 20, "expected seeded football knowledge");
assert.ok(loaded.sources.size >= 5, "expected provenance sources");

const motion = retrieveFootballKnowledge("safety alignment motion defensive response coverage", { limit: 10 });
assert.ok(motion.results.length > 0);
assert.ok(motion.results.some((r) => /motion|safety|coverage/i.test(r.title + " " + r.summary)));

const coryell = retrieveFootballKnowledge("Don Coryell passing offense history", { limit: 10 });
assert.ok(coryell.results.some((r) => /Coryell/i.test(r.title + " " + r.summary)));

const hypotheses = retrieveFootballKnowledge("fantasy coverage interaction", { limit: 20 });
const hypothesis = hypotheses.results.find((r) => r.knowledgeClass === "HYPOTHESIS");
assert.ok(hypothesis, "expected at least one hypothesis");
assert.strictEqual(hypothesis.productionUse, "research-only");

const noHypotheses = retrieveFootballKnowledge("fantasy coverage interaction", { limit: 20, includeHypotheses: false });
assert.ok(noHypotheses.results.every((r) => r.knowledgeClass !== "HYPOTHESIS"));

assert.ok(
  motion.results.every((r) => Array.isArray(r.resolvedProvenance)),
  "retrieval must preserve provenance"
);

console.log("Super SAGE football knowledge retrieval assertions passed.");
