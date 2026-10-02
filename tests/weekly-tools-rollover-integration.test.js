'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const recovery=require('../netlify/functions/_weekly-refresh-recovery');
const {_test}=require('../netlify/functions/chatgpt-mcp');
const RealDate=Date;
let instant=Date.parse('2026-10-06T05:59:59Z');
class TestDate extends RealDate {constructor(...args){super(...(args.length?args:[instant]));}static now(){return instant;}}
const stores=new Map();
function getStore({name}){if(!stores.has(name)){const records=new Map();let revision=0;stores.set(name,{get:async key=>records.get(key)?.data||null,getWithMetadata:async key=>records.get(key)||null,setJSON:async(key,data,options={})=>{const prior=records.get(key);if(options.onlyIfNew&&prior||options.onlyIfMatch&&prior?.etag!==options.onlyIfMatch)return{modified:false};records.set(key,{data:structuredClone(data),etag:String(++revision)});return{modified:true};}});}return stores.get(name);}
function fixture(job){const base={evidenceType:job.evidenceType,season:job.season,targetWeek:job.week,seasonType:'reg'};
 if(job.store==='weekly-sage-schedule')return{...base,games:[{}],gamesReturned:1};
 if(job.store==='weekly-sage-defense')return{...base,schedule:{completedGames:1,gamesReturned:1,processedGames:1},gameResults:[{status:'processed'}]};
 if(job.store==='opportunity-intel')return{...base,weeksRequested:[job.week],gamesFound:1,gamesFailed:0,records:{fixture:{}}};
 if(job.store==='risers-fallers')return{...base,currentWeek:job.week,previousWeek:job.week-1,allDeltas:{fixture:{}}};
 if(job.store==='player-data')return{updatedAt:new Date().toISOString(),teamsSucceeded:32,teamsFailed:0,players:Object.fromEntries(Array.from({length:1000},(_,i)=>[i,{}]))};
 if(job.store==='sage-newswire')return{updatedAt:new Date().toISOString(),mode:'editorial-with-sources',collection:{automaticStories:1},stories:[{headline:'Fixture verified news'}]};
 if(job.store==='weekly-projections')return{...base,generatedAt:new Date().toISOString(),rows:Array.from({length:100},()=>({}))};
 return{...base,population:[{}],failures:[],nextStep:{ready:true},populationSummary:{weeksWithEvidence:job.week-1,weeksScanned:job.week-1}};
}
const built=[],dispatches=[];let failWR=true;
function load(name,extra={}){const sandbox={exports:{},Date:TestDate,URL,process,console:{log(){},error(){}},fetch:async(url,options)=>{dispatches.push(options);const result=await worker.handler({httpMethod:'POST',headers:options.headers,body:options.body});return{ok:true,status:202,result};},require:p=>p==='@netlify/blobs'?{getStore,connectLambda(){}}:extra[p]||require('../netlify/functions/'+p)};vm.runInNewContext(fs.readFileSync('netlify/functions/'+name,'utf8'),sandbox);return sandbox.exports;}
const builders={};for(const job of recovery.jobsForWeek(2026,5))builders['./'+job.job+'.js']={handler:async event=>{const selected=recovery.jobsForWeek(2026,5).find(j=>j.job===job.job&&String(j.week)===(job.store==='opportunity-intel'?String(recovery.resolveCurrentNFLWeek(new Date())-1):event.queryStringParameters.week));built.push(selected.job+':'+selected.week);if(selected.job==='refresh-wr-snapshot'&&failWR)return{statusCode:429,body:JSON.stringify({error:'Fixture budget exhausted'})};await getStore({name:selected.store}).setJSON(recovery.cacheKey(selected),fixture(selected));return{statusCode:200,body:JSON.stringify({cached:true})};}};
const worker=load('weekly-sage-refresh-background.js',builders);
const watchdog=load('recover-weekly-sage.js');
async function main(){const savedDate=global.Date,savedFetch=global.fetch,token=process.env.TANK01_REFRESH_TOKEN,url=process.env.URL;global.Date=TestDate;process.env.TANK01_REFRESH_TOKEN='fixture-only-secret';process.env.URL='https://fixture.invalid';
 try{
  // Begin with complete Week 4 evidence, then run the real scheduler and signed worker at rollover.
  for(const job of recovery.jobsForWeek(2026,4))await getStore({name:job.store}).setJSON(recovery.cacheKey(job),fixture(job));
  assert.equal(JSON.parse((await watchdog.handler({})).body).ready,true);assert.equal(dispatches.length,0);
  instant=Date.parse('2026-10-06T06:00:00Z');
  await watchdog.handler({});assert(dispatches.length===1);assert(built.includes('refresh-weekly-sage-schedule:5'));assert(built.includes('refresh-weekly-sage-defense:4'));
  const wr=recovery.jobsForWeek(2026,5).find(j=>j.job==='refresh-wr-snapshot');
  assert.equal((await getStore({name:wr.store}).get(recovery.cacheKey(wr))),null,'failed new week is not published');
  assert(await getStore({name:wr.store}).get('week:2026:4:reg'),'old week is retained');
  let result=JSON.parse((await watchdog.handler({})).body);assert.equal(result.ready,false);
  instant+=31*60000;await watchdog.handler({});
  instant+=31*60000;await watchdog.handler({});assert.equal(built.filter(x=>x==='refresh-wr-snapshot:5').length,2,'daily failed attempts capped');
  failWR=false;instant=Date.parse('2026-10-07T06:00:00Z');
  for(let i=0;i<12;i++){await watchdog.handler({});if((await recovery.inspectJobs(getStore,2026,5)).every(j=>j.ready))break;}
  const rows=await recovery.inspectJobs(getStore,2026,5);assert(rows.every(j=>j.ready),JSON.stringify(rows.filter(j=>!j.ready)));
  for(const name of ['refresh-player-data','refresh-weekly-projections','refresh-sage-newswire'])assert(built.some(item=>item.startsWith(name+':')),name+' freshness recovered');
  assert.equal((await worker.handler({httpMethod:'POST',headers:{},body:'{}'})).statusCode,401,'unsigned refresh rejected');
  const count=built.length;await watchdog.handler({});assert.equal(built.length,count,'completed caches make no additional build calls');
  assert.equal(built.filter(x=>x==='refresh-weekly-sage-schedule:5').length,1,'dependency is not rebuilt on recovery');
  // Invoke the real registered customer tools immediately before and after Tuesday.
  const positions={QB:[{name:'Fixture Quarterback',position:'QB',playerID:'1',team:'BUF',rank:1,projectedPoints:20}],RB:[{name:'Fixture Runner',position:'RB',playerID:'2',team:'BUF',rank:1,projectedPoints:15}],WR:[],TE:[],K:[],DEF:[]};
  const snapshot={provider:'cbs',league:{season:2026,teamCount:12,currentWeek:4},scoringFormat:'half-ppr',roster:[{name:'Fixture Quarterback',position:'QB',status:'A'}],settings:{lineupSlots:[{slot:'QB',count:1}]}};
  const server=_test.buildServer(new Request('https://fixture.invalid/.netlify/functions/chatgpt-mcp'),{snapshot});
  for(const [time,week]of[['2026-10-06T05:59:59Z',4],['2026-10-06T06:00:00Z',5]]){instant=Date.parse(time);const requests=[];global.fetch=async target=>{requests.push(String(target));return{ok:true,status:200,json:async()=>({season:2026,week,positions,metadata:{complete:true}})};};
   for(const [name,args]of[['get_weekly_rankings',{position:'QB'}],['get_lineup_recommendation',{}],['compare_players',{players:['Fixture Quarterback','Fixture Runner']}]]){requests.length=0;const answer=await server._registeredTools[name].handler(args);assert(!answer.isError,JSON.stringify(answer));assert(requests.some(target=>new URL(target).searchParams.get('week')===String(week)),name+' must request current week '+week);}
  }
  console.log('PASS: real scheduled coordinator/signed worker, Week 4→5 dependency pipeline, 429 retry ceiling/next-day recovery, preserved old cache, completed-cache reuse, and ranking/lineup/comparison default weeks.');
 }finally{global.Date=savedDate;global.fetch=savedFetch;if(token===undefined)delete process.env.TANK01_REFRESH_TOKEN;else process.env.TANK01_REFRESH_TOKEN=token;if(url===undefined)delete process.env.URL;else process.env.URL=url;}}
main().catch(error=>{console.error(error);process.exitCode=1;});
