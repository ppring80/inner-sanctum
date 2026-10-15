"use strict";
const assert = require('node:assert/strict');
const {validateClaims} = require('../netlify/functions/_super-sage-rookie-claim-checks');
const {validatePairVoice} = require('../netlify/functions/_super-sage-shadow-voice');
const packet = {players:[{id:'A',name:'Kendre Miller',facts:[{field:'matchup',value:'Positive'}]},{id:'B',name:'Tyler Higbee',facts:[{field:'matchup',value:'Strong Positive'}]}]};
const bad = "Even with that uncertainty, Miller's better matchup and higher projection tip the balance his way over Higbee's stronger matchup label but lower projected output.";
assert.ok(validateClaims({explanation:bad},packet).includes('matchup_comparison_reversed'));
assert.ok(validatePairVoice({explanation:bad}).includes('report_like_customer_language'));
for(const text of ["Miller has the better matchup.","Miller faces an easier matchup.","Higbee has the tougher matchup."]) {
 assert.ok(validateClaims({explanation:text},packet).includes('matchup_comparison_reversed'),text);
}
for(const text of ["Higbee has the better matchup.","Miller has a tougher matchup.","Miller doesn't have the better matchup.","Miller's projection is higher, but Higbee has the better matchup."]) assert.deepEqual(validateClaims({explanation:text},packet),[],text);
const same={players:packet.players.map(p=>({...p,facts:[{field:'matchup',value:'Positive'}]}))};
assert.ok(validateClaims({explanation:"Miller has the better matchup."},same).includes('matchup_comparison_reversed'));
const missing={players:[packet.players[0],{...packet.players[1],facts:[]}]};
assert.deepEqual(validateClaims({explanation:"Miller has the better matchup."},missing),[]);
console.log('Named matchup comparisons: actual contradictory response rejected; correct, negated, equal and missing-label cases checked.');
