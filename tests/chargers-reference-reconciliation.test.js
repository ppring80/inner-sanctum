'use strict';
const assert=require('node:assert/strict'),{reconcileChargersReferences}=require('../netlify/functions/_chargers-reference-reconciliation');
const event={name:'Rashawn Slater',team:'LAC',identityVerified:true,kind:'RESERVE_PLACEMENT',status:'IR',reportedAt:'2026-10-09',sourceUrl:'https://www.chargers.com/team/transactions/2026'};
const claim={sourceText:'Rashawn Slater (ankle) was put on Injured Reserve on Friday.',articleDate:'2026-10-09'};
assert.equal(reconcileChargersReferences([claim],[event]).corroborated.length,1);
for(const change of [{reportedAt:'2026-10-10'},{reportedAt:'2026-10-02'},{team:'NO'},{identityVerified:false},{sourceUrl:'https://example.com/'},{status:'ACTIVE'}])assert.equal(reconcileChargersReferences([claim],[{...event,...change}]).unresolved.length,1);
assert.equal(reconcileChargersReferences([{...claim,sourceText:'If either player is placed on Injured Reserve, they would have to miss at least the next four games.'}],[]).hypothetical[0].createsEvent,false);
assert.equal(reconcileChargersReferences([{...claim,sourceText:'Another Player was placed on injured reserve.'}],[event]).unresolved.length,1);
console.log('PASS: dated recap corroboration, weekday, cutoff, identity/provenance and no hypothetical events.');
