"use strict";
const assert=require("assert");
const {buildOpponentQualityAdjustment}=require("../netlify/functions/_super-sage-opponent-quality");
const x=buildOpponentQualityAdjustment({games:[
 {passEpaPerDropback:-.2,dropbacks:30,opponentBaseline:-.1,opponentQuality:"weak",qbContext:"third-string"},
 {passEpaPerDropback:.1,dropbacks:40,opponentBaseline:.15,opponentQuality:"strong",qbContext:"starter"}
]});
assert.strictEqual(x.contextFlags.backupQbGames,1);
assert.ok(x.raw!==null);
assert.ok(x.opponentAdjusted!==null);
assert.strictEqual(x.canChangeProductionRanking,false);
console.log("Super SAGE opponent-quality assertions passed.");
