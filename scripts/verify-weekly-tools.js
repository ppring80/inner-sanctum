'use strict';
// Read-only production smoke check. Fixture availability is synthetic and
// never represents a customer's provider pool. No claim is submitted and
// none of these endpoints calls Tank01.
const assert=require('node:assert/strict');
const {resolveCurrentNFLWeek}=require('../netlify/functions/_current-nfl-week');
const base=process.env.SAGE_HEALTH_URL || 'https://theinnersanctum.xyz';
const positions=['QB','RB','WR','TE','K','DEF'];
async function request(name,body){
 const r=await fetch(`${base}/.netlify/functions/${name}`,{signal:AbortSignal.timeout(90000),...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
 const data=await r.json();assert.equal(r.status,200,`${name}: HTTP ${r.status}: ${JSON.stringify(data)}`);return data;
}
function identity(row){return {name:row.name,position:row.position,team:row.team};}
async function main(){
 const now=new Date(),season=now.getUTCMonth()===0?now.getUTCFullYear()-1:now.getUTCFullYear();
 if(season===2026 && now<Date.parse('2026-09-10T00:00:00Z')){console.log('Before regular-season opener; skipped.');return;}
 const week=resolveCurrentNFLWeek(now,season);assert(week,'Current season requires a supported week calendar.');
 const status=await request('weekly-sage-status');assert.equal(status.ready,true,'Weekly caches incomplete');assert.equal(status.week,week);
 const data=await request(`weekly-sage-rankings?season=${season}&week=${week}&scoring=half-ppr&evidenceUsage=archive`);
 assert.equal(data.metadata.complete,true);assert.equal(data.metadata.availability.fresh,true,'Player availability stale');assert.equal(data.metadata.projections.fresh,true,'Projections stale');
 const pool={};
 const {TRANSACTIONS,reserveTransaction}=require('../netlify/functions/_reserve-transactions');
 for(const transaction of TRANSACTIONS){if(!reserveTransaction(transaction,season,week))continue;assert(!Object.values(data.positions).flat().some(row=>String(row.playerID)===transaction.playerID||row.name===transaction.name),`${transaction.name}: confirmed reserve player appears in active rankings`);}
 for(const pos of positions){const rows=data.positions[pos];assert(rows.length>0,`${pos}: empty rankings`);assert(rows.every(x=>x.opponent),`${pos}: missing opponent`);pool[pos]=rows.filter(x=>Number.isFinite(x.projectedPoints));assert(pool[pos].length>0,`${pos}: no matched projections`);}
 const news=await request('sage-newswire');assert(news.stories.length>0);assert.equal(news.mode,'editorial-with-sources','Automatic editorial source refresh incomplete');assert(news.stories.every(s=>s.publishedAt&&s.sageImpact&&s.sageImpact.length>50),'Newswire lacks verified dates or analysis');assert(!news.stories.some(s=>/^(Latest Buzz|Depth Charts|Consistency Ratings|xTD Leaders|xFP Leaders)$/.test(s.headline)),'Generic resource links displaced player news');assert(!news.stories.some(s=>s.sageImpact.includes('This headline alone does not establish availability')),'Newswire boilerplate returned');assert(Date.now()-Date.parse(news.updatedAt)<24*3600000,'Newswire stale');
 for(const upgrade of [true,false]){
  const roster=[],availablePlayers=[];
  for(const pos of positions){const rows=pool[pos];const n=['RB','WR'].includes(pos)?2:1;const owned=upgrade?rows.slice(-n):rows.slice(0,n);roster.push(...owned.map(identity));const candidate=upgrade?rows[0]:rows.at(-1);availablePlayers.push({...identity(candidate),availabilityStatus:'FREE_AGENT'});}
  const result=await request('waiver-recommendations',{provider:'health-check-fixture',season,week,scoring:'half-ppr',teams:12,originalFaabBudget:200,roster,availablePlayers,lineupConstruction:{QB:1,RB:2,WR:2,TE:1,K:1,DEF:1}});
  assert.equal(result.metadata.sageIncomplete,false);assert.equal(result.metadata.sageFallbackUsed,false);assert.equal(result.metadata.scheduleDataAvailable,true);
  if(week>=2)assert.equal(result.metadata.opportunityDataAvailable,true,'Current opportunity evidence missing');
  if(week>=3)assert.equal(result.metadata.trendDataAvailable,true,'Current trend evidence missing');
  let bids=0;
  for(const row of result.recommendations){if(!row.faab)continue;bids++;assert(['ADD_NOW','STASH'].includes(row.verdict),'Unsupported verdict has bid');assert(row.swapFor||row.lineupFor||row.benchFor,'Bid has no roster move');assert.equal(row.faab.recommendedDollars,Math.round(row.faab.recommendedPct*2));}
  if(upgrade)assert(bids>0,'Verified upgrade fixture produced no bid');else assert.equal(bids,0,'Downgrade fixture produced bids');
 }
 console.log(`PASS: season ${season}, week ${week}; complete rankings, fresh availability/projections/news, current waiver evidence, supported FAAB bids and dollar conversion.`);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
