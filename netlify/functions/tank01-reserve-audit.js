'use strict';
// Temporary, fixed-input audit. One global five-call reservation, no retries.
const {connectLambda,getStore}=require('@netlify/blobs');
const {verifyWorkflowToken}=require('./_injury-workflow-auth');
const {requireTank01Budget}=require('./_tank01-daily-budget');
const HOST='tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com';
const KEY='reserve-fields-v1';
const EXPIRES=Date.parse('2026-10-22T00:00:00Z');
const TARGETS=[['Travis Etienne','NO'],['Thomas Harper','DET'],['Terrance Ferguson','LAR'],['Omar Cooper Jr.','NYJ'],['Jeremiah Owusu-Koramoah','CLE']];
const norm=s=>String(s||'').toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g,'').replace(/[^a-z]/g,'');
function fields(p){return Object.fromEntries(Object.entries(p||{}).filter(([k])=>/^(playerID|longName|team|teamAbv|teamID|pos|position|injury|rosterStatus|status|active|isFreeAgent|updatedAt|lastUpdated|injuryStatus|reserveStatus)$/.test(k)));}
async function audit({store,reserve,fetchImpl=fetch,apiKey,now=Date.now()}){
 const saved=await store.get(KEY,{type:'json'});if(saved)return saved;
 if(now>=EXPIRES)return {status:'EXPIRED'};
 if(!apiKey)return {status:'UNAVAILABLE',reason:'Provider credentials missing'};
 // Reserve a permanent run identity first: concurrent or subsequent invocations
 // never create another allowance, even after a timeout or a UTC rollover.
 const claim=await store.setJSON(KEY,{status:'RUNNING',startedAt:new Date(now).toISOString()},{onlyIfNew:true});
 if(claim?.modified!==true)return await store.get(KEY,{type:'json'})||{status:'UNAVAILABLE'};
 let calls=0;
 const out={status:'COMPLETE',capturedAt:new Date(now).toISOString(),calls:[],players:[]};
 async function call(endpoint,params){
  if(calls>=5)throw Error('CALL_LIMIT');calls++;
  const start=Date.now();
  const r=await fetchImpl(`https://${HOST}/${endpoint}?${new URLSearchParams(params)}`,{headers:{'x-rapidapi-host':HOST,'x-rapidapi-key':apiKey},signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('PROVIDER_HTTP_'+r.status);
  const data=await r.json();out.calls.push({endpoint,ms:Date.now()-start});
  if(data.error||data.statusCode&&Number(data.statusCode)!==200)throw Error('PROVIDER_BODY_ERROR');return data.body;
 }
 try{
  const b=await reserve();if(!b.allowed){out.status='BUDGET_BLOCKED';out.reason=b.reason;}
  else{
   const teams=await call('getNFLTeams',{rosters:'true'});
   if(!Array.isArray(teams)||teams.length!==32)throw Error('TEAM_COVERAGE_INCOMPLETE');
   const rows=teams.flatMap(t=>(Array.isArray(t.Roster)?t.Roster:Object.values(t.Roster||{})).map(p=>({...p,_team:t.teamAbv})));
   out.summary={teams:teams.length,players:rows.length,designationValues:[...new Set(rows.map(p=>p.injury?.designation).filter(Boolean))],statusLikeKeys:[...new Set(rows.flatMap(p=>Object.keys(p).filter(k=>/status|reserve|injur/i.test(k))))]};
   const missing=[];
   for(const [name,team]of TARGETS){const hits=rows.filter(p=>norm(p.longName)===norm(name)&&[p._team,p.team,p.teamAbv].includes(team));const entry={name,team,inTeamRoster:hits.length>0,roster:hits.map(fields)};out.players.push(entry);if(!hits.length)missing.push(entry);}
   await Promise.all(missing.slice(0,4).map(async entry=>{try{const body=await call('getNFLPlayerInfo',{playerName:entry.name,getStats:'false'});const list=Array.isArray(body)?body:body?[body]:[];entry.playerInfo=list.map(fields);entry.identityMatches=list.map(p=>norm(p.longName)===norm(entry.name)&&[p.team,p.teamAbv].includes(entry.team));}catch(_){entry.error='PLAYER_INFO_UNAVAILABLE';}}));
   for(const entry of missing.slice(4))entry.error='CALL_LIMIT';
  }
 }catch(error){out.status='FAILED';out.reason=/^(PROVIDER_HTTP_\d+|PROVIDER_BODY_ERROR|TEAM_COVERAGE_INCOMPLETE|CALL_LIMIT)$/.test(error.message)?error.message:'AUDIT_REQUEST_FAILED';}
 out.callsUsed=calls;
 const safe=JSON.parse(JSON.stringify(out).split(apiKey).join('[redacted]'));
 await store.setJSON(KEY,safe);return safe;
}
exports.handler=async event=>{
 if(!['GET','POST'].includes(event.httpMethod))return{statusCode:405};
 const token=String(event.headers?.authorization||event.headers?.Authorization||'').replace(/^Bearer /i,'');
 if(!await verifyWorkflowToken(token))return{statusCode:401,body:'Unauthorized'};
 connectLambda(event);const store=getStore({name:'tank01-reserve-audit'});
 const result=event.httpMethod==='GET'?await store.get(KEY,{type:'json'})||{status:'NOT_RUN'}:await audit({store,apiKey:process.env.TANK01_API_KEY,reserve:async()=>{const denied=await requireTank01Budget(event,{job:'tank01-reserve-field-audit',calls:5,priority:'normal',maxJobCalls:5});return denied?{allowed:false,reason:'Shared budget denied'}:{allowed:true};}});
 return{statusCode:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(result)};
};
exports._test={audit,fields};
