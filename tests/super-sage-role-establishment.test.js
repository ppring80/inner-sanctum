'use strict';
// All cases are synthetic. No source assertions, provider calls or fabricated history.
const assert=require('node:assert/strict');
const {fromSnapshot,normalizeName}=require('../netlify/functions/_super-sage-opportunity-evidence');
const {qualifyEvent,establishRole}=require('../netlify/functions/_super-sage-role-establishment');
const {buildLineupDecisionRecord}=require('../netlify/functions/_super-sage-lineup-decision');
const {toCustomerAnswer}=require('../netlify/functions/_super-sage-lineup-presenters');
const {reportedRoleEvents}=require('../netlify/functions/_reported-role-evidence');
const {hash,buildEvidence}=require('../netlify/functions/_super-sage-shadow-llm');
const clone=x=>JSON.parse(JSON.stringify(x));
const name='Role Receiver',position='WR',team='PIT',season=2026,week=7,scoring='half';
const event={id:'synthetic-gain',kind:'ROLE_GAIN',explicitRole:'STARTER',player:name,position,team,season,week,verified:true,fresh:true,authority:'TEAM_ANNOUNCEMENT',sourceUrl:'https://www.steelers.com/news/synthetic-role-case',effectiveAt:'2026-10-01',publishedAt:'2026-10-02T12:00:00Z',verifiedAt:'2026-10-20T11:00:00Z',dateBasis:'EFFECTIVE',statement:'Synthetic role change for testing only.'};
const raw=[['20260927_PIT@AAA',3,100],['20261004_PIT@AAA',4,8],['20261011_PIT@AAA',5,9],['20261018_PIT@AAA',6,10]].map(([gameID,week,targets])=>({gameID,week,targets,carries:0,opportunities:targets}));
function opportunity(games=raw){const p=require('../netlify/functions/refresh-opportunity-intel').buildOpportunityIntelligence(games,'WR');return fromSnapshot({season,computedAt:'2026-10-20T11:30:00Z',records:{[normalizeName(name)+'|WR']:{_rawGames:games,opportunities:p.opportunities,persistence:p.persistence,signals:p.signals}}},{season,week,decisionCutoff:'2026-10-20T12:00:00Z'});}
const projection={admissible:true,points:11,source:'Tank01',scoring,week,fresh:true,updatedAt:'2026-10-20T10:00:00Z'};
const statusEvidence=[{family:'availability',source:'Synthetic status',status:'ACTIVE',fresh:true,asOf:'2026-10-20T10:00:00Z'}];
const args={event,opportunity:opportunity(),projection,statusEvidence,name,position,team,season,week,scoring};
let passed=0;const test=(n,f)=>{f();passed++;console.log('PASS '+n);};
test('only post-change games use the unchanged producer sample and volume rules',()=>{const before=JSON.stringify(args),p=establishRole(args);assert.equal(p.status,'ESTABLISHED',JSON.stringify(p));assert.equal(p.gamesSampled,3);assert.equal(p.opportunities.avgLast3,9);assert.deepEqual(p.gameIDs,raw.slice(1).map(g=>g.gameID));assert.equal(p.workloadGrowthValidated,false);assert.equal(p.projectionIncorporationEstablished,false);assert.equal(JSON.stringify(args),before);});
test('old-season work, same-day work, a spike and duplicate games cannot establish a role',()=>{
 for(const games of [[raw[0],raw[1]],[],[{...raw[1],gameID:'20261001_PIT@AAA'}]])assert.notEqual(establishRole({...args,opportunity:opportunity(games)}).status,'ESTABLISHED');
 assert.equal(establishRole({...args,opportunity:opportunity([raw[1],raw[1],raw[2]])}).reason,'duplicate_post_change_games');
 const bad=clone(raw);bad[1].gameID='20251004_PIT@AAA';assert.notEqual(establishRole({...args,opportunity:opportunity(bad)}).status,'ESTABLISHED');
});
test('undated charts, stale/unknown authority, future events, mismatched identities and weeks fail closed',()=>{
 for(const patch of [{authority:'OFFICIAL_TRANSACTION'},{authority:'OFFICIAL_INJURY_REPORT'},{effectiveAt:null},{publishedAt:null},{dateBasis:'OBSERVED'},{fresh:false},{verified:false},{authority:'NEWSWIRE_INFERENCE'},{effectiveAt:'2025-10-01'},{verifiedAt:'2026-10-03'},{effectiveAt:'2026-10-21'},{team:'NE'},{position:'TE'},{player:'Different Receiver'},{season:2025},{week:6},{sourceUrl:'https://untrusted.example/news/fake'},{authority:'TEAM_CHART',coListed:true}])assert.notEqual(establishRole({...args,event:{...event,...patch}}).status,'ESTABLISHED',JSON.stringify(patch));
});
test('teammate absence, return or a demotion cannot be reinterpreted as a beneficiary promotion',()=>{
 for(const kind of ['TEAMMATE_ABSENCE','TEAMMATE_RETURN','ROLE_LOSS'])assert.equal(establishRole({...args,event:{...event,kind}}).reason,'beneficiary_role_not_confirmed');
 assert.equal(establishRole({...args,event:{...event,explicitRole:'EXPECTED_WORK'}}).reason,'beneficiary_role_not_confirmed');
});
test('same-date conflict and later superseding loss block the earlier gain',()=>{
 for(const effectiveAt of [event.effectiveAt,'2026-10-12'])assert.equal(establishRole({...args,conflictingEvents:[{...event,kind:'ROLE_LOSS',effectiveAt}]}).reason,'role_event_conflict');
});
test('post-change projection must be fresh, dated, in the requested format and week',()=>{
 for(const patch of [{updatedAt:null},{updatedAt:'2026-09-30'},{updatedAt:'2026-10-21'},{points:null},{admissible:false},{fresh:false},{scoring:'ppr'},{week:6},{source:null}])assert.equal(establishRole({...args,projection:{...projection,...patch}}).reason,'post_change_projection_unverified',JSON.stringify(patch));
});
test('unavailable, questionable, missing or conflicting status never clears',()=>{
 for(const status of ['OUT','QUESTIONABLE','UNVERIFIED'])assert.equal(establishRole({...args,statusEvidence:[{...statusEvidence[0],status}]}).reason,'current_availability_unverified');
 assert.equal(establishRole({...args,statusEvidence:[]}).reason,'current_availability_unverified');
 assert.equal(establishRole({...args,statusEvidence:[...statusEvidence,{...statusEvidence[0],family:'other',status:'QUESTIONABLE'}]}).reason,'current_availability_unverified');
});
function record({gain=event,environment=false,prior=false,post=raw,fixed=false,demotion=false}={}){
 const a={name,position,team,rank:35,recommendation:'FLEX',projectedPoints:11,projection:{...projection},availabilityVerified:true,matchup:'Positive',roleContext:{status:'REASSESS',event:gain,events:[gain],effectiveAt:gain.effectiveAt,note:gain.statement,...(prior?{priorContexts:[{note:'A separate undated teammate absence.'}]}:{})}};
 if(environment)a.environmentContext={type:'QB_AVAILABILITY_CHANGE',note:'A separate quarterback change.'};
 const b={name:'Prior Player',position:fixed?'WR':'TE',team:'XX',rank:17,recommendation:'FLEX',projectedPoints:8,projection:{...projection,points:8},availabilityVerified:true,matchup:'Positive'};
 if(demotion){a.rank=15;a.projectedPoints=4;a.projection.points=4;b.rank=35;}
 const positions={WR:[],TE:[]};for(const pos of ['WR','TE'])for(let rank=1;rank<=60;rank++){const start=pos==='WR'?24:12,flex=pos==='WR'?48:24;positions[pos].push({name:pos+' filler '+rank,position:pos,team:'XX',rank,recommendation:rank<=start?'START':rank<=flex?'FLEX':'SIT'});}positions.WR[a.rank-1]=a;positions[b.position][b.rank-1]=b;
 const opp=opportunity(post);if(opp.status==='AVAILABLE')opp.records[normalizeName(b.name)+'|'+b.position]={_rawGames:raw.slice(1),opportunities:{avgLast3:9,lastGame:10},persistence:{gamesSampled:3},signals:[{type:'sampleSize',value:'adequate'},{type:'volumeTier',value:'moderate-volume'}]};
 return buildLineupDecisionRecord({rankings:{positions,metadata:{availability:{updatedAt:'2026-10-20T11:00:00Z',fresh:true}}},roster:[{name,position},{name:b.name,position:b.position}],slots:[{slotLabel:fixed?'WR':'FLEX',eligiblePositions:fixed?['WR']:['WR','TE'],count:1}],scoring,season,week,opportunity:opp});
}
test('established role clears its trigger but not separate QB or teammate uncertainty',()=>{
 const r=record(),p=r.bench.find(p=>p.name===name)||r.slots.find(s=>s.starter?.name===name)?.starter;
 assert.equal(p.baselineValidity.state,'VALID');assert.equal(r.slots[0].starter.name,'Prior Player');assert.equal(r.slots[0].decisionState,'PROVISIONAL_UNRESOLVED');assert.equal(p.stateChanges[0].status,'ROLE_ESTABLISHED');assert.ok(!p.uncertainty.some(u=>u.code==='UNVERIFIED_REDISTRIBUTION'));
 for(const options of [{environment:true},{prior:true}]){const r=record(options),p=r.bench.find(p=>p.name===name)||r.slots.find(s=>s.starter?.name===name)?.starter;assert.equal(p.baselineValidity.state,'REASSESS');}
 const frozen=buildEvidence(r);assert.equal(hash(JSON.stringify(frozen.packet)),frozen.evidenceHash);
});
test('same-position Weekly SAGE authority remains; unestablished cross-position challenger is provisional',()=>{
 assert.equal(record({fixed:true}).slots[0].starter.name,'Prior Player');
 const r=record({post:[raw[0],raw[1]]}),s=r.slots[0];assert.equal(s.starter.name,'Prior Player');assert.equal(s.decisionState,'PROVISIONAL_UNRESOLVED');assert.equal(s.hasValidatedEdge,false);assert.match(toCustomerAnswer(r).threeSeconds.join(' '),/new role still needs dated/);
});
test('dated demotion keeps reassessment and permits only the existing same-position yield',()=>{
 const r=record({gain:{...event,kind:'ROLE_LOSS',explicitRole:'RESERVE'},fixed:true,demotion:true});
 assert.equal(r.slots[0].starter.name,'Prior Player');assert.equal(r.slots[0].decidedBy,'BASELINE_REASSESSED');
 assert.equal(r.slots[0].comparator.baselineValidity.state,'REASSESS');
 assert.equal(r.slots[0].comparator.stateChanges[0].establishment.status,'UNRESOLVED');
});
test('return activation alone never establishes the returning player role',()=>{
 const activation={...event,authority:'OFFICIAL_TRANSACTION'};
 assert.notEqual(establishRole({...args,event:activation}).status,'ESTABLISHED');
 const returning={...event,id:'synthetic-explicit-return-role'};
 assert.notEqual(establishRole({...args,event:returning,opportunity:opportunity([])}).status,'ESTABLISHED');
 assert.equal(establishRole({...args,event:returning}).status,'ESTABLISHED');
});
test('all supported positions can read structured official events; prose and wrong-team stories do not qualify',()=>{
 const now=new Date('2026-10-20T12:00:00Z');for(const pos of ['QB','RB','WR','TE']){
  const row={name,position:pos,team},roleReport={...event,type:'TEAM_REPORTED_ROLE_CHANGE'},story={editorial:true,player:name,position:pos,team,sourceUrl:event.sourceUrl,publishedAt:event.publishedAt,verifiedAt:event.verifiedAt,roleReport};
  assert.equal(reportedRoleEvents(row,[story],season,week,now).length,1);
  assert.equal(reportedRoleEvents(row,[{...story,roleReport:null,headline:'Now the starter'}],season,week,now).length,0);
  assert.equal(reportedRoleEvents(row,[{...story,team:'NE'}],season,week,now).length,0);
 }
});
test('the actual weekly enrichment path reaches selection, frozen evidence and customer explanation',()=>{
 const positions={WR:[{name,position,team,rank:1,recommendation:'START',availabilityVerified:true,matchup:'Positive',projectedPoints:11,projection:clone(projection)}]};
 const stories=[{editorial:true,player:name,position,team,sourceUrl:event.sourceUrl,publishedAt:event.publishedAt,verifiedAt:event.verifiedAt,roleReport:{...event,type:'TEAM_REPORTED_ROLE_CHANGE'}}];
 const before=JSON.stringify(stories);
 require('../netlify/functions/_reported-role-evidence').applyReportedRoleEvents(positions,stories,season,week,new Date('2026-10-20T12:00:00Z'));
 assert.equal(positions.WR[0].roleContext.effectiveAt,event.effectiveAt);assert.equal(positions.WR[0].roleContext.observedAt,event.verifiedAt);
 const r=buildLineupDecisionRecord({rankings:{positions,metadata:{availability:{fresh:true}}},roster:[{name,position}],slots:[{slotLabel:'WR',eligiblePositions:['WR'],count:1}],scoring,season,week,opportunity:opportunity()});
 assert.equal(r.slots[0].starter.name,name);assert.equal(r.slots[0].starter.baselineValidity.state,'VALID');
 const f=buildEvidence(r),change=f.packet.players[0].facts.find(f=>f.field==='stateChanges').value[0];
 assert.equal(change.event.sourceUrl,event.sourceUrl);assert.equal(change.effectiveAt,event.effectiveAt);assert.equal(change.establishment.status,'ESTABLISHED');
 assert.match(toCustomerAnswer(r).tenSeconds.join(' '),/work after 2026-10-01 supports the current role/);
 assert.equal(JSON.stringify(stories),before);
});
test('cached roster observation dates are never relabelled as effective change dates',()=>{
 const context=require('../netlify/functions/_injury-transactions').roleContext({name:'Reserve Back',position:'RB',team:'PIT'},{other:{longName:'Prior Back',pos:'RB',team:'PIT',injury:{designation:'IR'}}},[],season,week,'2026-10-20T11:00:00Z');
 assert.equal(context.effectiveAt,null);assert.equal(context.publishedAt,null);assert.equal(context.observedAt,'2026-10-20T11:00:00Z');assert.equal(context.evidenceDates[0].effectiveAt,null);
 assert.equal(context.evidenceDates[0].observedAt,context.observedAt);
});
test('same-date contradictory source order cannot choose a different event',()=>{
 const reader=require('../netlify/functions/_reported-role-evidence');
 const story=kind=>({editorial:true,player:name,position,team,sourceUrl:event.sourceUrl,publishedAt:event.publishedAt,verifiedAt:event.verifiedAt,roleReport:{...event,kind,type:'TEAM_REPORTED_ROLE_CHANGE'}});
 const a=reader.reportedRoleEvents({name,position,team},[story('ROLE_GAIN'),story('ROLE_LOSS')],season,week,new Date('2026-10-20T12:00:00Z'));
 const b=reader.reportedRoleEvents({name,position,team},[story('ROLE_LOSS'),story('ROLE_GAIN')],season,week,new Date('2026-10-20T12:00:00Z'));
 assert.deepEqual(a,b);assert.equal(establishRole({...args,event:a[0],conflictingEvents:a}).reason,'role_event_conflict');
});
test('two consistent meaningful games support only a provisional role; global sample stays limited',()=>{
 const games=raw.slice(1,3),p=establishRole({...args,opportunity:opportunity(games)});
 assert.equal(p.status,'ESTABLISHED');assert.equal(p.provisional,true);assert.equal(p.sampleSize,'limited');assert.equal(p.confidenceCap,'Moderate');assert.equal(p.workloadGrowthValidated,false);
 const r=record({fixed:true,post:games});assert.equal(r.slots[0].starter.name,'Prior Player');assert.equal(r.slots[0].confidence.label,'Moderate');
 assert.match(toCustomerAnswer(r).threeSeconds.join(' '),/only two games support the new role/);
 const frozen=buildEvidence(r);assert.match(JSON.stringify(frozen.packet),/confidenceCap/);
 assert.equal(establishRole(args).provisional,undefined);
 const confidence=require('../netlify/functions/_super-sage-lineup-decision').confidenceFor;
 const strong={standing:{tierIndex:0},uncertainty:[],establishedRole:{postChange:p}},weak={standing:{tierIndex:1},uncertainty:[]};
 assert.equal(confidence(strong,weak,'WITHIN_POSITION_ORDER').label,'Moderate');
 assert.equal(confidence({...strong,establishedRole:{}},weak,'WITHIN_POSITION_ORDER').label,'Strong');
 assert.equal(confidence({...strong,uncertainty:[{text:'injury'},{text:'QB'}]},weak,'WITHIN_POSITION_ORDER').label,'Limited');
});
test('one-game spikes, uneven or low-involvement pairs never qualify provisionally',()=>{
 for(const counts of [[0,12],[2,12],[5,12],[1,2]]){
  const games=raw.slice(1,3).map((g,i)=>({...g,targets:counts[i],opportunities:counts[i]}));
  assert.notEqual(establishRole({...args,opportunity:opportunity(games)}).status,'ESTABLISHED',JSON.stringify(counts));
 }
 for(const patch of [{fresh:false},{effectiveAt:null}])assert.notEqual(establishRole({...args,event:{...event,...patch},opportunity:opportunity(raw.slice(1,3))}).status,'ESTABLISHED');
 assert.equal(establishRole({...args,opportunity:opportunity(raw.slice(1,3)),conflictingEvents:[{...event,kind:'TEAMMATE_RETURN',effectiveAt:'2026-10-12'}]}).reason,'role_event_conflict');
 assert.equal(establishRole({...args,opportunity:opportunity(raw.slice(1,3)),statusEvidence:[]}).reason,'current_availability_unverified');
});
console.log(passed+' dated role-establishment checks passed');
