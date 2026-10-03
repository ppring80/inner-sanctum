"use strict";
const assert=require("assert");
const {buildRbMatchupIntelligence}=require("../netlify/functions/_super-sage-rb-matchup");
const x=buildRbMatchupIntelligence({player:"Test RB",offense:"AAA",defense:"BBB",schemeTeam:{source:"verified",sample:{plays:120},defense:{lightBoxPct:49,heavyBoxPct:23},offense:{personnel11Pct:55,personnel12Pct:31}},opportunity:{carriesPerGame:16,rushSharePct:61,targetsPerGame:5,routeParticipationPct:58,goalLineCarrySharePct:70,sample:{games:3},source:"verified role"}});
assert.strictEqual(x.primaryInteraction,"dual-role-vs-box");
assert.ok(x.advancedDetail.metrics.some(m=>m.label==="Goal-line carry share"));
assert.ok(x.progressiveDisclosure.prompt.includes("Test RB"));
assert.strictEqual(x.canChangeProductionRanking,false);
console.log("Super SAGE RB matchup intelligence assertions passed.");
