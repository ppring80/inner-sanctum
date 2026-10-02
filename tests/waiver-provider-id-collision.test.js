'use strict';
const assert=require('node:assert/strict');
const {_test:{findIdentityMatch,resolveCanonicalIdentity,enrichCandidates}}=require('../netlify/functions/waiver-candidates');
const {buildWaiverDecisions}=require('../netlify/functions/waiver-decision');
const {_test:{buildCustomerRecommendations}}=require('../netlify/functions/waiver-recommendations');
for(const position of ['QB','RB','WR','TE','K','DEF']){
 const target={playerID:'123',name:position==='DEF'?'BUF':'Jonathan Example',position,team:'BUF',opponent:'MIA',positionRank:1,sageScore:90,availabilityVerified:true};
 const wrong={name:position==='DEF'?'SEA':'J.J. Example',position,team:position==='DEF'?'SEA':null,availabilityStatus:'FREE_AGENT'};
 for(const key of ['providerPlayerId','playerId','id']){
  const candidate={...wrong,[key]:'123'};
  assert.equal(findIdentityMatch(candidate,[target]).match,null,`${position} ${key}: ID collision must not borrow rankings`);
  const canonical=resolveCanonicalIdentity(candidate,[target]);
  assert.notEqual(canonical.match?.name,target.name,`${position} ${key}: ID collision must not corrupt canonical identity`);
  const rows=enrichCandidates({availablePlayers:[candidate],roster:[],weeklyData:{positions:{[position]:[target]}},opportunityData:{records:{target}},risersFallersData:{risers:[target]}});
  assert.equal(rows[0].sage,null);assert.equal(rows[0].opportunity,null);assert.equal(rows[0].trend,null);
  const rec=buildCustomerRecommendations(buildWaiverDecisions(rows))[0];
  assert.equal(rec.verdict,'REVIEW');assert.equal(rec.faab,null);
 }
 // Full names and already-resolved canonical IDs preserve legitimate ID matching.
 const correct={...target,playerID:undefined,providerPlayerId:'123'};
 assert.equal(findIdentityMatch(correct,[target]).reason,'stable_id');
 assert.equal(resolveCanonicalIdentity(correct,[target]).match.name,target.name);
 if(position!=='DEF'){
  assert.equal(findIdentityMatch({name:'J. Example',position,providerPlayerId:'123'},[target]).match,target);
  assert.equal(findIdentityMatch({name:'Old Name',position,canonicalPlayerId:'123'},[target]).match,target);
 }
 // A colliding provider ID cannot prevent the correct name fallback.
 const other={...target,playerID:'456',name:position==='DEF'?'SEA':'Different Example',team:'SEA'};
 assert.equal(findIdentityMatch({...other,playerID:undefined,providerPlayerId:'123'},[target,other]).match,other);
}
assert.equal(findIdentityMatch({name:'J. Williams',position:'RB',providerPlayerId:'1'},[{name:'James Williams',position:'RB',playerID:'1'},{name:'Javonte Williams',position:'RB',playerID:'2'}]).match,null,'An overlapping provider ID cannot resolve an ambiguous abbreviation');
console.log('PASS: all six positions reject conflicting provider IDs across SAGE, registry, usage, trends and actionable FAAB; canonical IDs and legitimate name fallback retained.');
