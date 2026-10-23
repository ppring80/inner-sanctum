'use strict';
const assert=require('node:assert/strict');
const {articleEvidence,extractReports,mergeHistory}=require('../netlify/functions/_role-event-ingestion');
const {claimsForArticle}=require('../netlify/functions/_role-report-claims');
const {qualifyEvent,establishRole}=require('../netlify/functions/_super-sage-role-establishment');
const fixtures=require('./fixtures/role-reports/coverage-excerpts.json');
const NOW=Date.parse('2026-10-23T02:45:00Z');
function parse(s,patch={}){
 const doc={'@type':'NewsArticle',url:s.url,headline:s.headline,datePublished:s.publishedAt,dateModified:s.modifiedAt,articleBody:s.excerpt,...patch};
 return articleEvidence('<script type="application/ld+json">'+JSON.stringify(doc)+'</script>',s.url);
}
function extract(s,time,patch={}){
 const a=parse(s,patch);assert(a,s.id+' source metadata');
 const names=s.id==='committee'?['Bucky Irving','Sean Tucker','Kenny Gainwell']:[s.name];
 const players=Object.fromEntries(names.map((longName,i)=>[i,{longName,pos:s.pos||'RB',team:s.team||'TB'}]));
 return extractReports([{link:s.url,publishedAt:a.publishedAt,_roleArticle:a}],{updatedAt:new Date(time).toISOString(),players},{season:2026,now:time});
}
for(const s of fixtures){
 // Historical sources are exercised at a controlled as-of time too, so stale
 // rejection cannot hide false starter classification in negative controls.
 const asOf=Date.parse(s.modifiedAt)+3600000,then=extract(s,asOf),current=extract(s,NOW);
 if(['mccarthy','mccarthy-nfl','daniels','daniels-nfl'].includes(s.id)){
  assert.equal(then.reports.length,1,s.id);const r=then.reports[0];assert.equal(r.kind,'ROLE_GAIN',s.id);
  assert.equal(r.actualEffectiveAt,null);assert.equal(r.effectiveAt,new Date(Date.parse(s.modifiedAt)).toISOString());
  assert.equal(r.firstAffectedGameID,undefined);assert.equal(r.publishedAt,s.publishedAt);
  assert(qualifyEvent(r,{name:s.name,position:s.pos,team:s.team,season:2026,week:r.week,cutoff:new Date(asOf).toISOString()}).valid);
  if(s.id.startsWith('daniels')){assert.equal(current.reports.length,0);assert.equal(current.rejected[0].reason,'SOURCE_PUBLICATION_STALE');}
  else assert.equal(current.reports.length,1,s.id+' current source');
 }else if(s.id==='committee'){
  assert(then.reports.length>=2);assert(then.reports.every(r=>r.kind==='ROLE_REASSESSMENT'&&r.explicitRole==='UNRESOLVED'));
  for(const event of then.reports)assert.equal(establishRole({event,name:event.player,position:event.position,team:event.team,season:2026,week:event.week,opportunity:{provenance:{decisionCutoff:new Date(asOf).toISOString()}}}).reason,'beneficiary_role_not_confirmed');
 }else assert.equal(then.reports.length,0,s.id+' cannot imply starter or clearance');
 assert.equal(extract(s,NOW,{datePublished:'2026-09-01T00:00:00Z',dateModified:'2026-10-23T01:00:00Z'}).reports.length,0,'Recent edit cannot freshen old publication');
}
const future=fixtures.find(s=>s.id==='mccarthy');assert.equal(extract(future,NOW,{articleBody:"J.J. McCarthy will be the Giants' starting quarterback in Week 8."}).reports.length,0,'Future named week cannot apply early');
const nextWeek=extract(future,NOW,{articleBody:"J.J. McCarthy will start for the Giants next week."});
assert.equal(require('../netlify/functions/_role-event-ingestion').roleHistoryStories(mergeHistory(null,nextWeek,{season:2026,now:NOW}),2026,7,NOW).length,0,'Future unresolved role cannot leak into current week');
const p={longName:'Fixture Player',team:'NYG',pos:'QB'},article=body=>({body,headline:'Giants role report',sourceTeam:'NYG'});
for(const body of [
 'Fixture Player will start practicing for the Giants on Thursday.',
 'Fixture Player will be not the Giants starting quarterback.',
 'Fixture Player might be named the Giants starting quarterback.',
 'If cleared, Fixture Player will start for the Giants.',
 'Fixture Player will start for the Giants unless the incumbent returns.',
 'This is a hypothetical example. Fixture Player will start for the Giants.',
 'Fixture Player will start for the Giants next week.'
])assert.equal(claimsForArticle(article(body),[p],{season:2026}).claims.length,0,body);
const unknown=claimsForArticle(article('Fixture Player earned the starting quarterback assignment for the Giants.'),[p],{season:2026});assert.equal(unknown.claims.length,0);assert.equal(unknown.unresolved.length,1);
for(const body of ["The Texans have named Fixture Player their starting quarterback against the New York Giants.","Fixture Player will be the Texans starting quarterback against the Giants.","Fixture Player will start for the Texans against the Giants."])assert.equal(claimsForArticle({body,headline:'Giants role report'},[p],{season:2026}).claims.length,0,'Announcing team must match, not just opponent');
const collision=claimsForArticle(article('Fixture Player will start for the Giants.'),[p,{...p,team:'TB'}],{season:2026});assert.equal(collision.claims.length,0);
const conflicting=claimsForArticle(article('Fixture Player will start for the Giants. Fixture Player has been benched.'),[p],{season:2026});assert.equal(conflicting.claims[0].kind,'ROLE_REASSESSMENT');
// Unsupported claims persist for review, bounded and deduplicated; no gain.
const batch={reports:[],articles:[],rejected:[],identityFresh:true,coverage:'PARTIAL',unresolved:unknown.unresolved.map(c=>({...c,sourceUrl:'https://www.giants.com/news/fixture'}))};
const history=mergeHistory(null,batch,{season:2026,now:NOW});assert.equal(history.unresolved.length,1);assert.equal(mergeHistory(history,batch,{season:2026,now:NOW}).unresolved.length,1);assert.equal(history.events.length,0);
// Unresolved source assertions reach customer reassessment, not silent baseline
// protection and not an invented starter gain. A corrected source resolves them.
const uncertain=extract(future,NOW,{articleBody:"J.J. McCarthy earned the starting quarterback assignment for the Giants."});
assert.equal(uncertain.reports.length,0);assert.equal(uncertain.unresolved.length,1);
const uncertainHistory=mergeHistory(null,uncertain,{season:2026,now:NOW});
const stories=require('../netlify/functions/_role-event-ingestion').roleHistoryStories(uncertainHistory,2026,7,NOW);
const positions={QB:[{name:'J.J. McCarthy',position:'QB',team:'NYG',rank:4,recommendation:'START',availabilityVerified:true,projectedPoints:20,projection:{points:20,source:'Tank01',fresh:true,week:7,scoring:'half',updatedAt:new Date(NOW).toISOString()}}]};
require('../netlify/functions/_reported-role-evidence').applyReportedRoleEvents(positions,stories,2026,7,new Date(NOW));
assert.equal(positions.QB[0].roleContext.event.kind,'ROLE_REASSESSMENT');
const record=require('../netlify/functions/_super-sage-lineup-decision').buildLineupDecisionRecord({rankings:{positions,metadata:{availability:{fresh:true}}},roster:[{name:'J.J. McCarthy',position:'QB'}],slots:[{slotLabel:'QB',eligiblePositions:['QB'],count:1}],season:2026,week:7,scoring:'half'});
assert.equal(record.slots[0].starter.baselineValidity.state,'REASSESS','Unresolved report cannot silently protect an incumbent');
assert.equal(record.slots[0].confidence.label,'Limited');
assert.match(require('../netlify/functions/_super-sage-lineup-presenters').toCustomerAnswer(record).oneSecond.join(' '),/Role evidence unresolved.*Limited confidence/);
assert.doesNotMatch(JSON.stringify(record.slots[0].starter.baselineValidity),/Verified role change/);
const corrected=extract(future,NOW,{articleBody:'This report was withdrawn.'});
const resolved=mergeHistory(uncertainHistory,corrected,{season:2026,now:NOW});
assert.equal(require('../netlify/functions/_role-event-ingestion').roleHistoryStories(resolved,2026,7,NOW).length,0);
const reporter={...fixtures[0],url:'https://plus.steelersnow.com/articles/fixture'};
assert.equal(parse(reporter,{author:{name:'Unregistered Writer'}}),null);
assert(parse(reporter,{author:{name:'Chris Ward'}}),'Registered reporter adapter retains actual author');
assert.equal(parse(fixtures[0],{dateModified:'invalid'}),null);
assert.equal(parse(fixtures[0],{dateModified:'2020-01-01T00:00:00Z'}),null);
console.log('PASS: seven real-source excerpt cases at source-time and current-time, edited dates, initials, nonlead assertions, stale history, uncertainty, negative controls, review queue and registered authors.');
