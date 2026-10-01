"use strict";

const assert = require("assert");
const { normalizeCandidateStories, validateCoverageSeed } = require("../netlify/functions/refresh-super-sage-evidence");

const now = Date.parse("2026-10-01T05:00:00Z");
const items = [
  { title: "BUF WR Example ruled out after ankle injury", description: "Practice update", link: "https://www.nfl.com/news/example", publishedAt: "2026-09-30T20:00:00Z", sourceLabel: "NFL.com" },
  { title: "Power rankings: Week 4", description: "Opinion", link: "https://www.espn.com/example", publishedAt: "2026-09-30T20:00:00Z", sourceLabel: "ESPN" },
  { title: "Old injury story", description: "injury", link: "https://www.nfl.com/news/old", publishedAt: "2026-09-20T20:00:00Z", sourceLabel: "NFL.com" },
  { title: "Untrusted injury", description: "injury", link: "https://spam.example/x", publishedAt: "2026-09-30T20:00:00Z", sourceLabel: "Spam" }
];
const normalized = normalizeCandidateStories(items, now);
assert.strictEqual(normalized.length, 1);
assert.strictEqual(normalized[0].type, "INJURY_STATUS");
assert.strictEqual(normalized[0].sourceTier, "primary");

const seed = {
  generatedAt: "2026-10-01T05:00:00Z",
  evidence: [{
    type: "SCHEME",
    sourceTier: "trusted-data",
    source: "Verified scheme source",
    claim: "Team uses zone at supplied rate.",
    observedAt: "2026-09-30T20:00:00Z",
    season: 2026,
    week: 4,
    team: "BUF",
    metric: "zone_rate",
    value: 70,
    unit: "percent"
  }]
};
const validated = validateCoverageSeed(seed);
assert.strictEqual(validated.accepted.length, 1);
assert.strictEqual(validated.rejected.length, 0);

console.log("Super SAGE evidence refresh assertions passed.");
