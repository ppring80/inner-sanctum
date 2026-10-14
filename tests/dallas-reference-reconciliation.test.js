'use strict';
const assert=require('node:assert/strict'),{reconcileDallasReferences}=require('../netlify/functions/_dallas-reference-reconciliation');
const claim={sourceUrl:'https://www.dallascowboys.com/news/tyler-smith-leaves-door-open-for-return-vs-bucs-on-thursday-i-think-it-s-possible',articleDate:'2026-10-06',sourceText:'Smith was placed on injured reserve before the season began.'};
const event={name:'Tyler Smith',team:'DAL',kind:'RESERVE_EXIT',status:'ACTIVE',reportedAt:'2026-10-08',sourceUrl:'https://www.dallascowboys.com/news/tyler-smith-officially-activated-from-ir-for-cowboys-vs-buccaneers',identityVerified:true};
assert.equal(reconcileDallasReferences([claim],[event]).corroborated[0].createsEvent,false);
for(const change of [{identityVerified:false},{sourceUrl:'https://example.com/'},{name:'Another Smith'}])assert.equal(reconcileDallasReferences([claim],[{...event,...change}]).unresolved.length,1);
assert.equal(reconcileDallasReferences([{sourceText:'Malik Hooker was not placed on IR-to return, with the hopes he could return before the four-week window.'}],[]).excluded[0].classification,'EXPLICIT_NEGATION');
assert.equal(reconcileDallasReferences([{sourceText:'Jalen Williams and P.J. Locke already on IR.'}],[{...event,name:'Jalen Thompson'}]).unresolved.length,1);
console.log('PASS: historical references retain dates, official identity required, negation and no silent name correction.');
