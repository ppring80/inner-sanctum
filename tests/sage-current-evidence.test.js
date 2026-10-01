"use strict";

const assert = require("assert");
const {
  normalizeCurrentEvidence,
  assessEvidenceFreshness,
  buildCurrentEvidencePacket
} = require("../netlify/functions/_sage-current-evidence");

const injury = normalizeCurrentEvidence({
  type: "INJURY_STATUS",
  sourceTier: "primary",
  source: "Official team injury report",
  sourceUrl: "https://example.test/injury",
  claim: "Player is listed OUT.",
  observedAt: "2026-09-30T20:00:00Z",
  season: 2026,
  week: 4,
  team: "TEST",
  player: "Example Player"
});
assert.strictEqual(injury.type, "INJURY_STATUS");

const fresh = assessEvidenceFreshness(injury, new Date("2026-10-01T00:00:00Z"));
assert.strictEqual(fresh.fresh, true);

const stale = assessEvidenceFreshness(injury, new Date("2026-10-05T00:00:00Z"));
assert.strictEqual(stale.fresh, false);

assert.throws(() => normalizeCurrentEvidence({
  type: "TEAM_TENDENCY",
  sourceTier: "analytical",
  claim: "Team uses two-high often.",
  observedAt: "2026-09-30T20:00:00Z"
}), /source/);

const packet = buildCurrentEvidencePacket([
  {
    type: "SCHEME",
    sourceTier: "trusted-data",
    source: "Verified scheme dataset",
    claim: "Team uses a documented coverage structure at the supplied rate.",
    observedAt: "2026-09-30T20:00:00Z",
    season: 2026,
    week: 4,
    team: "TEST",
    metric: "coverage_rate",
    value: 52.4,
    unit: "percent",
    sample: { dropbacks: 120 }
  }
], { now: "2026-10-01T00:00:00Z" });

assert.strictEqual(packet.readyForReasoning, true);
assert.strictEqual(packet.canChangeProductionRanking, false);
assert.strictEqual(packet.evidence[0].sample.dropbacks, 120);

const contradicted = buildCurrentEvidencePacket([
  {
    type: "PLAYER_ROLE",
    sourceTier: "trusted-reporting",
    source: "Reporter A",
    claim: "Player expected to start.",
    observedAt: "2026-09-30T20:00:00Z",
    contradicts: true,
    note: "Official depth chart conflicts."
  }
], { now: "2026-10-01T00:00:00Z" });
assert.strictEqual(contradicted.readyForReasoning, false);

console.log("Super SAGE current evidence assertions passed.");
