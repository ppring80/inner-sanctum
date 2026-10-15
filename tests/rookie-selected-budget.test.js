"use strict";
const assert = require('node:assert/strict');
const {selectedBudgetKeys, selectedBudgetFull, reserveSelectedBudget} = require('../netlify/functions/_super-sage-shadow-fast-review');
(async () => {
 const now = new Date('2026-10-15T01:00:00Z'), data = new Map();
 const first = selectedBudgetKeys(now)[0], legacy = {decisionId:'prior-review',version:'legacy'};
 data.set(first, legacy);
 const store = {get: async key => data.get(key), setJSON: async (key,value,opts) => {
   assert.equal(opts.onlyIfNew,true);
   if(data.has(key))return {modified:false};
   data.set(key,value);return {modified:true};
 }};
 assert.equal(await selectedBudgetFull(store,now),false);
 const reservations = await Promise.all(Array.from({length:12},(_,n)=>reserveSelectedBudget(store,now,{review:n})));
 assert.equal(reservations.filter(r=>r.modified).length,4,'legacy call plus four concurrent calls reaches five');
 assert.equal(new Set(reservations.filter(r=>r.modified).map(r=>r.key)).size,4);
 assert.strictEqual(data.get(first),legacy,'prior spend remains untouched');
 assert.equal(await selectedBudgetFull(store,now),true);
 assert.equal((await reserveSelectedBudget(store,now,{})).modified,false);
 assert.equal((await reserveSelectedBudget(store,new Date('2026-10-16T00:00:00Z'),{})).modified,true);
 assert.strictEqual(data.get(first),legacy,'rollover preserves history');
 console.log('Selected pair budget: five global atomic daily slots, legacy spend counted, concurrent cap and next-day rollover.');
})().catch(e=>{console.error(e);process.exitCode=1});
