'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('netlify/functions/weekly-sage-rankings.js','utf8');
const begin = source.indexOf('function orderPositionsByDisplayedProjections(positions) {');
const end = source.indexOf('\nfunction reconcileRankedRecommendations', begin);
assert(begin >= 0 && end > begin, 'projection ordering function present');
assert(source.indexOf('orderPositionsByDisplayedProjections(positions);') < source.indexOf('reconcileRankedRecommendations(positions, scoring);'));
const context = { POSITIONS: ['QB','RB','WR','TE','K','DEF'] };
vm.createContext(context);
vm.runInContext(source.slice(begin,end)+'\nthis.order = orderPositionsByDisplayedProjections;',context);
const row = (name,points,eligible=true) => ({name,projectedPoints:points,projection:points==null?null:{points},eligibleForWeeklyRanking:eligible});
for (const position of context.POSITIONS) {
  const positions = {[position]:[row('low',14.8),row('high',20.4),row('middle',18.7),row('inactive',30,false)]};
  const audit = context.order(positions);
  assert.equal(audit[position].applied,true,position+' ordered');
  assert.deepEqual(positions[position].map(x=>x.name),['high','middle','low','inactive']);
}
const partial = {WR:[row('low',14.8),row('unknown',null),row('high',20.4)]};
assert.equal(context.order(partial).WR.applied,false);
assert.deepEqual(partial.WR.map(x=>x.name),['low','unknown','high']);
const tie = {QB:[row('first',12),row('second',12)]};
context.order(tie);
assert.deepEqual(tie.QB.map(x=>x.name),['first','second']);
console.log('PASS: six positions, descending projections, inactive, missing evidence, stable ties');
