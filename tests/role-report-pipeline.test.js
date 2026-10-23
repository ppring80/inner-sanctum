'use strict';
// Synthetic source fixtures, not a historical production replay.
const assert=require('node:assert/strict');
const roles=require('../netlify/functions/_role-event-ingestion');
const clubs=require('../netlify/functions/_official-club-sources.json');
const {articleMetadata,collectSources}=require('../netlify/functions/_newswire-sources');
const {reportedRoleEvents,applyReportedRoleEvents}=require('../netlify/functions/_reported-role-evidence');
const {qualifyEvent,establishRole}=require('../netlify/functions/_super-sage-role-establishment');
const now=Date.parse('2026-10-22T18:00:00Z'),publishedAt='2026-10-22T17:00:00Z';
const player={longName:'Example Receiver',pos:'WR',team:'SEA'};
const identity=(p=player,time=now)=>({updatedAt:new Date(time).toISOString(),players:{one:p}});
function item(body,{url='https://www.nfl.com/news/test-role',date=publishedAt,extra={}}={}){
 const doc={'@type':'NewsArticle',url,headline:'Role reporting',description:'A source fixture',datePublished:date,articleBody:body,...extra};
 const html='<script type="application/ld+json">'+JSON.stringify(doc)+'</script>';
 return {html,...articleMetadata(html,url)};
}
function extract(source,cache=identity(),time=now){return roles.extractReports([source],cache,{season:2026,now:time});}
function merge(previous,batch,time=now,seeds=[]){return roles.mergeHistory(previous,batch,{season:2026,now:time,seeds});}
const gain='The Seahawks have named Example Receiver their starting wide receiver.';
const source=item(gain),parsed=extract(source);
assert.equal(parsed.reports.length,1);assert.equal(parsed.reports[0].effectiveAt,publishedAt);assert.equal(parsed.reports[0].dateBasis,'PUBLISHED');
assert.equal(parsed.reports[0].firstAffectedGameID,undefined,'No invented game or historical effective date');
assert.equal(parsed.reports[0].sourceQuote,gain);
// Generic identity/team/position rules, not a growing per-player allowlist.
for(const club of clubs)for(const [pos,word]of Object.entries({QB:'quarterback',RB:'running back',WR:'wide receiver',TE:'tight end'})){
 const p={longName:'Fixture Player',pos,team:club.team};
 const s=item(`The ${club.club} have named Fixture Player their starting ${word}.`);
 const x=extract(s,identity(p));assert.equal(x.reports.length,1,club.team+' '+pos);
 assert(qualifyEvent(x.reports[0],{name:p.longName,position:pos,team:club.team,season:2026,week:7,cutoff:new Date(now).toISOString()}).valid);
}
for(const text of [
 'The Seahawks may name Example Receiver their starting wide receiver.',
 'The Seahawks have not named Example Receiver their starting wide receiver.',
 'If healthy, the Seahawks have named Example Receiver their starting wide receiver.',
 'The Seahawks have named Example Receiver their starting wide receiver in 2025.',
 'The Seahawks have named Example Receiver their starting wide receiver next week.',
 'The Seahawks have named Example Receiver and Another Player their starting wide receivers.',
 'Example Receiver should start after a teammate injury.',
 'Example Receiver is first on an undated Seahawks depth chart.',
 '"The Seahawks have named Example Receiver their starting wide receiver."',
 "The coach denied the report: The Seahawks have named Example Receiver their starting wide receiver.",
 'The Rams have named Example Receiver their starting wide receiver.',
 'The Seahawks have named Example Receiver their starting quarterback.'
 ,'This is a hypothetical example. The Seahawks have named Example Receiver their starting wide receiver.'
])assert.equal(extract(item(text)).reports.length,0,text);
for(const bad of [
 {...source,_roleArticle:null},
 {...source,_roleArticle:{...source._roleArticle,body:gain+' Edited.'}},
 item(gain,{url:'https://evil.example/news/test-role'}),
 item(gain,{date:'2026-10-23T17:00:00Z'}),
 item(gain,{date:'2026-10-01T17:00:00Z'}),
 item(gain,{extra:{url:'https://www.nfl.com/news/other'}}),
 item(gain,{extra:{articleBody:null}}),
 item(gain,{extra:{articleBody:'<p>'+gain+'</p>'}})

 ,item(gain,{extra:{headline:'Seahawks deny starter rumour'}})
])assert.equal(extract(bad).reports.length,0,'Unverified body/date/source rejected');
const edited=extract(item(gain,{extra:{dateModified:'2026-10-22T17:30:00Z'}}));assert.equal(edited.reports.length,1);assert.equal(edited.reports[0].effectiveAt,'2026-10-22T17:30:00.000Z');assert.equal(edited.reports[0].actualEffectiveAt,null);
assert.equal(roles.articleEvidence(source.html+source.html,source.link),null,'Ambiguous article metadata');
assert.equal(roles.articleEvidence('<script type="application/ld+json">null</script>',source.link),null);
assert.equal(extract(source,identity(player,now-8*3600000)).reports.length,0,'Stale identity cannot produce evidence');
const duplicate=identity();duplicate.players.two={...player,team:'LAR'};
assert.equal(extract(source,duplicate).reports.length,0,'Same-name identities cannot be guessed');
const first=merge(null,parsed),again=merge(first,extract(source,identity(player,now+3600000),now+3600000),now+3600000);
assert.equal(again.events.length,1);assert.equal(again.events[0].verifiedAt,first.events[0].verifiedAt,'Repeated reads cannot renew freshness');
assert.equal(roles.roleHistoryStories(first,2026,8,now+8*86400000)[0].roleReport.fresh,false,'Retained history becomes stale, never disappears');
assert.equal(roles.roleHistoryStories(first,2026,6,now).length,0,'Future event week cannot contaminate prior decisions');
assert.equal(roles.roleHistoryStories(first,2025,7,now).length,0);
const withdrawn=merge(first,extract(item('The report has been corrected.')));
assert(withdrawn.events[0].withdrawnAt);assert.equal(roles.roleHistoryStories(withdrawn,2026,7,now)[0].roleReport.fresh,false);
const confirmation=item("Example Receiver remains the Seahawks' starting wide receiver.",{url:'https://www.nfl.com/news/confirmation',date:'2026-10-22T17:30:00Z'});
const renewed=merge(first,extract(confirmation));assert.equal(renewed.events.length,1);assert.equal(renewed.events[0].effectiveAt,publishedAt);assert.equal(renewed.events[0].currentRoleConfirmation.sourceUrl,confirmation.link);
assert.equal(merge(null,extract(confirmation)).events.length,0,'Confirmation cannot invent the original change date');
assert.equal(merge(first,extract(item("Example Receiver remains the Seahawks' starting wide receiver.",{url:'https://www.nfl.com/news/old-confirmation',date:'2026-10-22T16:00:00Z'}))).events[0].currentRoleConfirmation,undefined);
const correction=merge(renewed,extract(item('This confirmation was withdrawn.',{url:confirmation.link,date:'2026-10-22T17:30:00Z'})));
assert(correction.events[0].withdrawnAt,'Withdrawn corroboration cannot remain current');
const editorialSeed={...first.events[0]};delete editorialSeed.ingestion;
const corroboratedSeed=merge(null,extract(confirmation),now,[editorialSeed]);
assert(corroboratedSeed.events[0].currentRoleConfirmation,'Editorial history can receive an independent dated corroboration');
assert(merge(corroboratedSeed,extract(item('This confirmation was withdrawn.',{url:confirmation.link,date:'2026-10-22T17:30:00Z'}))).events[0].withdrawnAt,'The same withdrawal guard applies to editorial and automatic events');
const loss=item('The Seahawks have moved Example Receiver to their bench.',{url:'https://www.nfl.com/news/loss',date:'2026-10-22T17:40:00Z'});
const lost=merge(first,extract(loss));assert.equal(lost.events.length,2);
const row={name:player.longName,position:'WR',team:'SEA'};
const events=reportedRoleEvents(row,roles.roleHistoryStories(lost,2026,7,now),2026,7,new Date(now));
assert.equal(events[0].kind,'ROLE_LOSS');
assert.equal(establishRole({event:events[0],...row,season:2026,week:7,opportunity:{provenance:{decisionCutoff:new Date(now).toISOString()}}}).reason,'beneficiary_role_not_confirmed');
const sameDateLoss=extract(item('The Seahawks have moved Example Receiver to their bench.',{url:'https://www.nfl.com/news/conflict'}));
const conflict=merge(first,sameDateLoss);const conflicted=reportedRoleEvents(row,roles.roleHistoryStories(conflict,2026,7,now),2026,7,new Date(now));
assert.equal(conflicted.length,2);assert.equal(establishRole({event:conflicted.find(e=>e.kind==='ROLE_GAIN'),conflictingEvents:conflicted,...row,season:2026,week:7,opportunity:{provenance:{decisionCutoff:new Date(now).toISOString()}}}).reason,'role_event_conflict');
assert.equal(roles.mergeRoleStories(roles.roleHistoryStories(renewed,2026,7),roles.roleHistoryStories(first,2026,7)).length,1,'Seed/history deduplication');
// Original announcement, later independent confirmation, two post-change games.
const initialTime=Date.parse('2026-10-04T18:00:00Z');
const oldGain=extract(item(gain,{date:'2026-10-04T17:00:00Z'}),identity(player,initialTime),initialTime);
const oldHistory=merge(null,oldGain,initialTime);
const current=merge(oldHistory,extract(confirmation));
const positions={WR:[{...row,recommendation:'FLEX',rank:40,availabilityVerified:true,projection:{source:'Tank01',points:10,scoring:'half',week:7,fresh:true,updatedAt:new Date(now).toISOString()}}]};
applyReportedRoleEvents(positions,roles.roleHistoryStories(current,2026,7,now),2026,7,new Date(now));
const games=[{gameID:'20261011_SEA@LAR',week:5,carries:0,targets:10,opportunities:10},{gameID:'20261018_LAR@SEA',week:6,carries:0,targets:12,opportunities:12}];
const {fromSnapshot,normalizeName}=require('../netlify/functions/_super-sage-opportunity-evidence');
const work=require('../netlify/functions/refresh-opportunity-intel').buildOpportunityIntelligence(games,'WR');
const opportunity=fromSnapshot({season:2026,computedAt:new Date(now).toISOString(),records:{[normalizeName(row.name)+'|WR']:{_rawGames:games,...work}}},{season:2026,week:7,decisionCutoff:new Date(now).toISOString()});
const proof=establishRole({event:positions.WR[0].roleContext.event,opportunity,projection:{...positions.WR[0].projection,admissible:true},statusEvidence:[{family:'controlled',source:'fixture',status:'ACTIVE',fresh:true}],...row,season:2026,week:7,scoring:'half'});
assert.equal(proof.status,'ESTABLISHED',JSON.stringify(proof));assert.equal(proof.provisional,true);assert.equal(proof.gamesSampled,2);assert.equal(proof.sampleSize,'limited');assert.equal(proof.confidenceCap,'Moderate');assert.equal(proof.workloadGrowthValidated,false);
// CAS contention, capacity and fail-closed persistence (no provider dependency).
(async()=>{
 assert.equal(await roles.readRoleHistory(()=>{throw Error('Store unavailable');},2026),null,'Synchronous optional-store errors cannot fail rankings');
 assert.equal(await roles.readRoleHistory(()=>({get:async()=>{throw Error('Read unavailable');}}),2026),null,'Async optional-store errors cannot fail rankings');
 let data=null,etag=0,writes=0;
 const store={async getWithMetadata(){return data?{data:structuredClone(data),etag:String(etag)}:null;},async setJSON(k,next,options){writes++;if(options.onlyIfNew?data!==null:options.onlyIfMatch!==String(etag))return {modified:false};data=next;etag++;return {modified:true};}};
 const second=item('The Seahawks have moved Example Receiver to their bench.',{url:'https://www.nfl.com/news/second'});
 await Promise.all([source,second].map(s=>roles.ingestRoleReports({store,items:[s],playerCache:identity(),season:2026,now,seeds:[]})));
 assert.equal(data.events.length,2,'Concurrent refreshes retain both reports');assert(writes>=3);
 const stored=structuredClone(data);await roles.ingestRoleReports({store,items:[],playerCache:null,season:2026,now,seeds:[]});assert.deepEqual(data.events,stored.events,'A failed source/identity refresh cannot erase history');
 await assert.rejects(roles.ingestRoleReports({store:{getWithMetadata:async()=>null,setJSON:async()=>({modified:false})},items:[source],playerCache:identity(),season:2026,now,seeds:[]}),/contention/);
 assert.throws(()=>merge({version:99,season:2026,events:[]},parsed),/contract/);
 const full={version:roles.VERSION,season:2026,events:Array.from({length:roles.MAX_EVENTS},(_,i)=>({...first.events[0],id:String(i)}))};assert.throws(()=>merge(full,parsed),/capacity/);
 // Existing collection request bound remains two feeds + index + six articles.
 let calls=0;await collectSources(async url=>{calls++;return {ok:true,text:async()=>url.includes('rsslanding')?'<a href="/news/example-starter-report">Report</a>':url.includes('/news/')?source.html:'<rss></rss>'};});assert.equal(calls,4);
 const requested=[];await collectSources(async url=>{requested.push(url);return {ok:true,text:async()=>url.includes('rsslanding')?'<a href="/news/new-starter">Role</a>'+Array.from({length:6},(_,i)=>'<a href="/news/injury-'+i+'">Injury</a>').join(''):url.includes('/news/')?source.html:'<rss></rss>'};});
 assert.equal(requested.length,9,'Two feeds, index and original six-article ceiling');assert(!requested.some(u=>u.endsWith('/new-starter')),'New role discovery cannot displace existing injury reports');
 console.log('PASS: 32-club/four-position source fixtures, ambiguity, history, independent confirmation, conflicts, two-game proof, CAS and bounded discovery.');
})().catch(e=>{console.error(e);process.exitCode=1;});
