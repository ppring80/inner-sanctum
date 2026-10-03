"use strict";
const assert=require("assert");
const {buildStartSitIntelligence}=require("../netlify/functions/_super-sage-start-sit");
const x=buildStartSitIntelligence({weeklySagePreferredPlayer:"Alpha RB",candidates:[
 {player:"Alpha RB",position:"RB",weeklyRank:14,confidence:"high",intelligence:{summary:{threeSecond:"Receiving usage protects the floor."},advancedDetail:{metrics:[{label:"Targets",value:5,source:"verified",sample:{games:3}}],caveats:["Goal-line share can change."]}}},
 {player:"Beta WR",position:"WR",weeklyRank:17,confidence:"moderate",intelligence:{summary:{threeSecond:"Target opportunity is strong."},advancedDetail:{metrics:[],caveats:[]}}}
]});
assert.strictEqual(x.preferredPlayer,"Alpha RB");
assert.strictEqual(x.summary.oneSecond,"START ALPHA RB");
assert.strictEqual(x.authority.ranking,"Weekly SAGE");
assert.strictEqual(x.canChangeProductionRanking,false);
assert.ok(x.progressiveDisclosure.prompt.includes("deeper SAGE comparison"));
console.log("Super SAGE Start/Sit Intelligence assertions passed.");
