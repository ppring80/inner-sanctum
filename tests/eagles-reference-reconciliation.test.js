'use strict';
const assert=require('node:assert/strict'),{reconcileEaglesReferences}=require('../netlify/functions/_eagles-reference-reconciliation');
const claim={sourceUrl:'https://www.philadelphiaeagles.com/news/eagles-sign-dameon-pierce-to-the-active-roster-erik-ezukanma-to-the-practice-squad',articleDate:'2026-10-07',sourceText:'One day after the Eagles placed running back Tank Bigsby on Injured Reserve, the team filled his spot on the 53-man roster with another running back – Dameon Pierce from the practice squad.'};
const event={name:'Tank Bigsby',team:'PHI',kind:'RESERVE_PLACEMENT',status:'IR',reportedAt:'2026-10-06',identityVerified:true,sourceUrl:'https://www.philadelphiaeagles.com/team/transactions/2026'};
assert.equal(reconcileEaglesReferences([claim],[event]).corroborated[0].createsEvent,false);
for(const change of [{reportedAt:'2026-10-05'},{name:'Saquon Barkley'},{identityVerified:false},{sourceUrl:'https://example.com/'},{status:'ACTIVE'},{team:'LAR'}])assert.equal(reconcileEaglesReferences([claim],[{...event,...change}]).unresolved.length,1);
const pair={...claim,articleDate:'2026-10-09',sourceText:'Steele joins Dameon Pierce as the two running backs signed to the active roster this week after injuries to Saquon Barkley and Tank Bigsby - the latter of whom was placed on Injured Reserve.'};assert.equal(reconcileEaglesReferences([pair],[event]).corroborated[0].matchedEvent.name,'Tank Bigsby');
assert.equal(reconcileEaglesReferences([{...claim,sourceText:'Shipley is healthy and will receive every carry.'}],[event]).unresolved.length,1);
console.log('PASS: sourced Eagles recaps, explicit latter subject, one-day timing, identity/provenance and no unsupported claims.');
