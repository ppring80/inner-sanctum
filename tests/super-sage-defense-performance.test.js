"use strict";
const assert=require("assert");
const {buildDefensivePerformanceMatrix,buildDefenseTrend}=require("../netlify/functions/_super-sage-defense-performance");
const rows=[
 {team:"AAA",games:3,dropbacks:100,rushes:70,passEpaPerDropback:.20,rushEpaPerCarry:-.10,passYardsPerGame:270,rushYardsPerGame:90},
 {team:"BBB",games:3,dropbacks:95,rushes:80,passEpaPerDropback:-.15,rushEpaPerCarry:.12,passYardsPerGame:190,rushYardsPerGame:150}
];
const m=buildDefensivePerformanceMatrix(rows,{season:2026,throughWeek:4,source:"verified"});
assert.strictEqual(m.teams.BBB.pass.epaRank,1);
assert.strictEqual(m.teams.AAA.rush.epaRank,1);
assert.strictEqual(m.teams.AAA.pass.yardsRank,2);
assert.ok(/ranking metric/.test(m.rules[0]));
assert.strictEqual(buildDefenseTrend({season:{epaRank:28},recent3:{epaRank:19}}).direction,"improving");
assert.strictEqual(m.canChangeProductionRanking,false);
console.log("Super SAGE Defensive Performance Tributary assertions passed.");
