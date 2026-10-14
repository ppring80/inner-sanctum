'use strict';
const assert=require('node:assert/strict'),{compatiblePosition}=require('../netlify/functions/_club-position-identity');
for(const pair of [['G','OL'],['OT','OL'],['DE','EDGE'],['CB','DB'],['ILB','LB'],['DT','DL'],['RB','RB']]){
 assert.equal(compatiblePosition(...pair),true);assert.equal(compatiblePosition(...pair.slice().reverse()),true);
}
for(const pair of [['RB','WR'],['QB','RB'],['G','OT'],['DE','DT'],['DE','LB'],['TE','OL'],['UNKNOWN','OL'],['','RB']])assert.equal(compatiblePosition(...pair),false);
console.log('PASS: documented broad/specific official position labels match; unrelated and sibling roles remain distinct.');
