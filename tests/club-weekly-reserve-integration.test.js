'use strict';
const assert=require('node:assert/strict');
const {applyCentralAvailability}=require('../netlify/functions/weekly-sage-rankings');
const {weeklyReserveDecision}=require('../netlify/functions/_club-weekly-reserve');
const originalNow=Date.now;Date.now=()=>Date.parse('2026-10-14T03:00:00Z');
try{
 const row={name:'Observed Back',playerID:'p1',team:'PHI',position:'RB'};
 const source={sourceUrl:'https://www.philadelphiaeagles.com/team/players-roster/',profileUrl:'https://www.philadelphiaeagles.com/team/players-roster/observed-back/',status:'IR'};
 const record={...row,status:'IR',lastVerifiedStatus:'IR',placementDate:null,observedAt:'2026-10-14T02:50:00Z',customerEligible:false,conflicts:[],provenance:[source]};
 const report={team:'PHI',season:2026,asOf:'2026-10-14T02:50:00Z',collectionHealthy:true,discoveryComplete:false,coveragePassed:false,players:[record]};
 const prior={...row,season:2026,status:'IR',reportedAt:'2026-09-25',source:'NFL official transactions',sourceUrl:'https://www.nfl.com/transactions/league/reserve-list/2026/9'};
 function run({enabled=true,reportValue=report,transactions=[],injury={},week=6}={}){
  const positions={RB:[{...row}]},inactive={},availability={players:{p1:{longName:row.name,team:row.team,pos:'RB',injury}},byName:new Map(),fresh:true,transactions:structuredClone(transactions),clubCustomerReadsEnabled:enabled,clubReserveEvidence:{teams:{PHI:reportValue}}};
  applyCentralAvailability(positions,inactive,availability,2026,week);return {positions,inactive,availability};
 }
 assert.equal(run({enabled:false}).positions.RB.length,1,'Default-off customer path keeps established behavior');
 const restricted=run();assert.equal(restricted.positions.RB.length,0);assert.equal(restricted.inactive.RB[0].status,'IR');assert.ok(restricted.inactive.RB[0].reason.includes('placement date is unverified'));
 assert.equal(run({week:5}).positions.RB.length,1,'Live evidence never rewrites an earlier requested week');
 const exit={sourceUrl:'https://www.philadelphiaeagles.com/news/activation',identityVerified:true,kind:'RESERVE_EXIT',status:'ACTIVE',reportedAt:'2026-10-13'};
 const activated={...report,discoveryComplete:true,players:[{...record,status:'ACTIVE',customerEligible:true,provenance:[exit]}]};
 const original=JSON.stringify(prior);
 const cleared=run({reportValue:activated,transactions:[prior],injury:{designation:'IR'}});
 assert.equal(cleared.positions.RB.length,1);assert.equal(cleared.availability.transactions[0].status,'ACTIVE');assert.equal(JSON.stringify(prior),original,'Frozen/source transactions are never changed');
 assert.equal(run({reportValue:activated,transactions:[prior],injury:{designation:'OUT'}}).positions.RB.length,0,'Activation does not clear a separate injury report');
 assert.equal(run({reportValue:activated,transactions:[{...prior,reportedAt:'2026-10-13'}]}).positions.RB.length,0,'Same-day event ordering stays unresolved');
 assert.equal(run({reportValue:{...activated,asOf:'2026-10-13T23:00:00Z'},transactions:[prior]}).positions.RB.length,0,'Stale activation never clears reserve status');
 assert.equal(weeklyReserveDecision({player:row,season:2026,week:6,report,baseline:{...prior,status:'ACTIVE',reportedAt:'2026-10-13'},enabled:true}).action,'NO_OVERRIDE','Undated roster restriction cannot override a newer explicit activation');
 const departure={...activated,players:[{...record,status:'DEPARTED',customerEligible:false,provenance:[{...exit,kind:'DEPARTURE',status:'DEPARTED'}]}]};
 const departed=run({reportValue:departure});assert.equal(departed.inactive.RB[0].status,'INACTIVE');assert.ok(!departed.inactive.RB[0].reason.includes('Current injury report'));
 console.log('PASS: real weekly reader applies scoped reserve restrictions, fresh explicit exits and departures without changing old weeks, frozen records or separate injury designations.');
}finally{Date.now=originalNow;}
