"use strict";

const assert = require("assert");
const { buildFootballReasoningPacket } = require("../netlify/functions/_sage-football-reasoning");
const { buildSageSkepticReview } = require("../netlify/functions/_sage-football-skeptic");

const packet = buildFootballReasoningPacket("How does motion interact with coverage?");

const withoutCurrent = buildSageSkepticReview(packet, []);
assert.strictEqual(withoutCurrent.passed, false);
assert.strictEqual(withoutCurrent.canMakeCurrentMatchupClaim, false);
assert.strictEqual(withoutCurrent.canChangeProductionRanking, false);
assert.ok(withoutCurrent.concerns.some((c) => /No current NFL evidence/i.test(c)));

const withCurrent = buildSageSkepticReview(packet, [
  { source: "verified-current-source", claim: "Current team uses motion frequently", contradicts: false }
]);
assert.strictEqual(withCurrent.canMakeCurrentMatchupClaim, true);
assert.strictEqual(withCurrent.canChangeProductionRanking, false);

const contradicted = buildSageSkepticReview(packet, [
  { source: "verified-current-source", claim: "Counterevidence", contradicts: true, note: "Current evidence conflicts with the proposed tendency." }
]);
assert.strictEqual(contradicted.passed, false);
assert.ok(contradicted.concerns.some((c) => /conflicts/i.test(c)));

console.log("Super SAGE skeptic assertions passed.");
