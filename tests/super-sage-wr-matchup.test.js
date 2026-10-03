"use strict";
const assert=require("assert");
const {buildWrMatchupIntelligence}=require("../netlify/functions/_super-sage-wr-matchup");
const x=buildWrMatchupIntelligence({player:"Test WR",offense:"AAA",defense:"BBB",schemeTeam:{source:"verified",sample:{dropbacks:100},defense:{zonePct:70,cover3Pct:35}},opportunity:{targetsPerGame:8,targetSharePct:27,airYardsPerGame:92,adot:11.5,sample:{games:3},source:"Historical Lab"}});
assert.strictEqual(x.primaryInteraction,"coverage-opportunity");
assert.ok(x.advancedDetail.metrics.some(m=>m.label==="Air yards/game"));
assert.ok(x.progressiveDisclosure.prompt.includes("Test WR"));
assert.strictEqual(x.canChangeProductionRanking,false);
console.log("Super SAGE WR matchup intelligence assertions passed.");
