"use strict";
const assert=require("assert");
const {buildQbStressProfile,compareQbToDefenseStress}=require("../netlify/functions/_super-sage-qb-stress");
const plays=[
 {qb_dropback:1,passer_player_id:"Q",epa:.4,success:1,sack:0,qb_hit:0,qb_scramble:0,yards_gained:22,cpoe:5},
 {qb_dropback:1,passer_player_id:"Q",epa:-.7,success:0,sack:1,qb_hit:1,qb_scramble:0,yards_gained:-8,cpoe:null},
 {qb_dropback:1,passer_player_id:"Q",epa:.2,success:1,sack:0,qb_hit:1,qb_scramble:0,yards_gained:8,cpoe:2},
 {qb_dropback:1,rusher_player_id:"Q",epa:.3,success:1,sack:0,qb_hit:0,qb_scramble:1,yards_gained:12,cpoe:null}
];
const p=buildQbStressProfile(plays,{qbId:"Q",qbName:"Test QB"});
assert.strictEqual(p.all.dropbacks,4);
assert.strictEqual(p.disruptionProxy.dropbacks,2);
assert.strictEqual(p.disruptionProxyPct,50);
assert.ok(/not equivalent/i.test(p.pressureDefinition));
const m=compareQbToDefenseStress(p,{disruptionProxyPct:38,blitzPct:25});
assert.strictEqual(m.interpretationReady,true);
assert.strictEqual(m.canChangeProductionRanking,false);
console.log("Super SAGE QB Stress Matrix assertions passed.");
