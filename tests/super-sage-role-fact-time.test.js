'use strict';
const assert=require('node:assert/strict');
const {decideSharedLineup}=require('../netlify/functions/_super-sage-lineup-service');
const {buildLineupDecisionRecord}=require('../netlify/functions/_super-sage-lineup-decision');
const {fromSnapshot,normalizeName}=require('../netlify/functions/_super-sage-opportunity-evidence');
const {toCustomerAnswer}=require('../netlify/functions/_super-sage-lineup-presenters');
// Controlled fixtures reproduce the observed timing failure; not a historical replay.
const firstKickoff='2026-10-23T00:15:00.000Z',now=new Date('2026-10-23T02:00:00Z');
const name='Fixture Receiver Jr.',position='WR',team='PIT',season=2026,week=7,scoring='half';
const event={id:'fixture-first-start',player:name,position,team,season,week:5,appliesFromWeek:5,kind:'ROLE_GAIN',explicitRole:'STARTER',authority:'TEAM_ANNOUNCEMENT',sourceUrl:'https://www.nfl.com/news/fixture-first-start',publishedAt:'2026-10-11',effectiveAt:'2026-10-11',dateBasis:'EFFECTIVE',firstAffectedGameID:'20261011_IND@PIT',firstAffectedGameVerified:true,verified:true,fresh:true,verifiedAt:'2026-10-21T22:05:22Z',statement:'Controlled dated starter report.'};
const games=[{gameID:'20261004_PIT@CLE',week:4,carries:0,targets:2,opportunities:2},{gameID:'20261011_IND@PIT',week:5,carries:1,targets:9,opportunities:10},{gameID:'20261018_PIT@TB',week:6,carries:0,targets:12,opportunities:12}];
const producer=require('../netlify/functions/refresh-opportunity-intel').buildOpportunityIntelligence;
const raw={season,computedAt:'2026-10-21T00:20:45Z',records:{[normalizeName(name)+'|WR']:{_rawGames:games,...producer(games,'WR')}}};
const otherGames=[{gameID:'20261004_LAR@PHI',week:4,carries:0,targets:6,opportunities:6},{gameID:'20261012_BUF@LAR',week:5,carries:0,targets:6,opportunities:6},{gameID:'20261018_ARI@LAR',week:6,carries:0,targets:4,opportunities:4}];
raw.records[normalizeName('Prior Tight End')+'|TE']={_rawGames:otherGames,...producer(otherGames,'TE')};
function rankings(){
 const positions={WR:[],TE:[]};
 for(const [pos,total,start,flex]of [['WR',60,24,48],['TE',36,12,24]])for(let rank=1;rank<=total;rank++)positions[pos].push({name:pos+' filler '+rank,position:pos,team:'XX',rank,recommendation:rank<=start?'START':rank<=flex?'FLEX':'SIT'});
 const projection={points:10.32,source:'Tank01',scoring,week,fresh:true,updatedAt:'2026-10-23T00:40:22.944Z'};
 positions.WR[38]={name,position,team,rank:39,recommendation:'FLEX',availabilityVerified:true,matchup:'Positive',projectedPoints:10.32,projection,roleContext:{status:'REASSESS',event:structuredClone(event),events:[structuredClone(event)],note:event.statement}};
 positions.TE[16]={name:'Prior Tight End',position:'TE',team:'LAR',rank:17,recommendation:'FLEX',availabilityVerified:true,matchup:'Positive',projectedPoints:7.78,projection:{...projection,points:7.78},environmentContext:{type:'QB_AVAILABILITY_CHANGE',note:'Fixture changed quarterback environment.'}};
 return {positions,metadata:{availability:{fresh:true,available:true,updatedAt:'2026-10-23T00:00:22Z'},projections:{available:true,fresh:true,source:'Tank01',updatedAt:projection.updatedAt}}};
}
const schedule={season,week,games:[{gameID:'20261022_NE@CHI',away:'NE',home:'CHI',gameTime_epoch:Date.parse(firstKickoff)/1000},{gameID:'20261025_PIT@NO',away:'PIT',home:'NO',gameTime_epoch:Date.parse('2026-10-25T17:00:00Z')/1000},{gameID:'20261025_LAR@SF',away:'LAR',home:'SF',gameTime_epoch:Date.parse('2026-10-25T20:25:00Z')/1000}]};
const roster=[{name,eligiblePositions:['WR'],rosterStatus:'A'},{name:'Prior Tight End',eligiblePositions:['TE'],rosterStatus:'A'}],slots=[{slotLabel:'FLEX',eligiblePositions:['WR','TE'],count:1}];
const base={roster,slots,season,week,scoring,schedule,now,opportunityStore:{get:async()=>structuredClone(raw)}};
const player=r=>[...r.slots.flatMap(s=>[s.starter,s.comparator]),...r.bench,...r.unavailable].find(p=>p?.name===name);
(async()=>{
 const legacy=buildLineupDecisionRecord({...base,rankings:rankings(),roster:roster.map(p=>({name:p.name,position:p.eligiblePositions[0],rosterStatus:p.rosterStatus})),opportunity:fromSnapshot(raw,{season,week,decisionCutoff:firstKickoff})});
 assert.equal(player(legacy).stateChanges[0].establishment.reason,'post_change_projection_unverified','Reproduce the original cutoff error');
 const fixed=await decideSharedLineup({...base,rankings:rankings()}),p=player(fixed.record),proof=p.establishedRole.postChange;
 assert.equal(fixed.record.slots[0].starter.name,name);assert.equal(fixed.record.slots[0].confidence.label,'Moderate');assert.equal(proof.gamesSampled,2);assert.equal(proof.sampleSize,'limited');assert.equal(proof.provisional,true);assert.equal(proof.confidenceCap,'Moderate');assert.equal(proof.workloadGrowthValidated,false);assert.equal(proof.factsCutoff,'2026-10-23T00:40:22.944Z');
 assert.equal(p.observedOpportunity.provenance.decisionCutoff,firstKickoff,'Historical outcome cutoff is unchanged');assert.match(toCustomerAnswer(fixed.record).threeSeconds.join(' '),/only two games/);
 const repeat=await decideSharedLineup({...base,rankings:rankings(),now:new Date('2026-10-23T02:01:00Z')});assert.equal(fixed.record.decisionId,repeat.record.decisionId,'Unchanged evidence keeps ID and review deduplication');
 const future=rankings();future.positions.WR[38].projection.updatedAt='2026-10-23T03:00:00Z';assert.notEqual(player((await decideSharedLineup({...base,rankings:future})).record).baselineValidity.state,'VALID','Future projection cannot enter current facts');
 const futureReport=rankings();futureReport.positions.WR[38].roleContext.event.verifiedAt='2026-10-23T03:00:00Z';futureReport.positions.WR[38].roleContext.events[0].verifiedAt='2026-10-23T03:00:00Z';const tooEarly=await decideSharedLineup({...base,rankings:futureReport});assert.notEqual(player(tooEarly.record).baselineValidity.state,'VALID','Future role verification cannot enter current facts');
 const actuallyKnown=await decideSharedLineup({...base,rankings:futureReport,now:new Date('2026-10-23T04:00:00Z')});assert.equal(player(actuallyKnown.record).baselineValidity.state,'VALID');assert.notEqual(tooEarly.record.decisionId,actuallyKnown.record.decisionId,'A changed fact-admission boundary must not reuse a contradictory frozen decision ID');
 const fridayReport=rankings();fridayReport.positions.WR[38].roleContext.event.verifiedAt='2026-10-23T01:00:00Z';fridayReport.positions.WR[38].roleContext.events[0].verifiedAt='2026-10-23T01:00:00Z';assert.equal(player((await decideSharedLineup({...base,rankings:fridayReport})).record).baselineValidity.state,'VALID','New verification for an unchanged pre-existing role remains usable after Thursday');
 for(const badGame of [{gameID:'20261022_PIT@NO',week:7,carries:0,targets:20,opportunities:20},{gameID:'20261025_PIT@NO',week:7,carries:0,targets:20,opportunities:20}]){
  const bad=structuredClone(raw);bad.records[normalizeName(name)+'|WR']._rawGames.push(badGame);
  const r=await decideSharedLineup({...base,rankings:rankings(),opportunityStore:{get:async()=>bad}});assert.notEqual(r.evidenceStatus.opportunity.status,'AVAILABLE','Current-week/future outcomes still fail closed');
 }
 const missingSchedule=await decideSharedLineup({...base,rankings:rankings(),schedule:null});assert.notEqual(player(missingSchedule.record)?.baselineValidity.state,'VALID','No schedule means no widened fact window');
 const locked=await decideSharedLineup({...base,rankings:rankings(),now:new Date('2026-10-25T17:00:00Z')});assert(locked.record.unavailable.some(p=>p.name===name),'Own kickoff still locks the player');
 const uncertainty=rankings();uncertainty.positions.WR[38].environmentContext={type:'QB_AVAILABILITY_CHANGE',note:'Unrelated QB concern.'};const limited=player((await decideSharedLineup({...base,rankings:uncertainty})).record);assert.equal(limited.baselineValidity.state,'REASSESS');assert.equal(limited.stateChanges.find(c=>c.type==='ROLE_CHANGE').status,'ROLE_ESTABLISHED','Only role concern clears');
 const stale=rankings();stale.positions.WR[38].projection.fresh=false;assert.notEqual(player((await decideSharedLineup({...base,rankings:stale})).record).baselineValidity.state,'VALID','Stale projections still fail');
 const wrongFormat=rankings();wrongFormat.positions.WR[38].projection.scoring='ppr';assert.notEqual(player((await decideSharedLineup({...base,rankings:wrongFormat})).record).baselineValidity.state,'VALID','Scoring safeguards remain');
 console.log('PASS: post-Thursday current facts, unchanged outcome cutoff, future rejection, own kickoff, stable IDs, two-game caveat and unrelated uncertainty.');
})().catch(e=>{console.error(e);process.exitCode=1;});
