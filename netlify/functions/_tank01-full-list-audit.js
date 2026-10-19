'use strict';
const {requireTank01Budget}=require('./_tank01-daily-budget');
const KEY='full-player-list-v1';
const TARGETS=['Travis Etienne','Thomas Harper','Terrance Ferguson','Omar Cooper','Jeremiah Owusu'];
async function fullListAudit({store,event,reserve=async()=>!await requireTank01Budget(event,{job:'tank01-full-player-list-audit',calls:1,maxJobCalls:1}),fetchImpl=fetch,apiKey,now=Date.now()}){
 const saved=await store.get(KEY,{type:'json'});if(saved)return saved;
 if(now>=Date.parse('2026-10-22T00:00:00Z')||!apiKey)return{status:'UNAVAILABLE'};
 const claim=await store.setJSON(KEY,{status:'RUNNING'},{onlyIfNew:true});if(claim?.modified!==true)return await store.get(KEY,{type:'json'});
 let out;try{
  if(!await reserve())out={status:'BUDGET_BLOCKED'};
  else{
   const r=await fetchImpl('https://tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com/getNFLPlayerList',{headers:{'x-rapidapi-host':'tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com','x-rapidapi-key':apiKey},signal:AbortSignal.timeout(12000)});
   if(!r.ok)throw Error('Provider failure');const data=await r.json();if(data.error||!Array.isArray(data.body))throw Error('Provider shape');
   const rows=data.body;const fields=require('./tank01-reserve-audit')._test.fields;
   out={status:'COMPLETE',capturedAt:new Date(now).toISOString(),players:rows.length,designationValues:[...new Set(rows.map(p=>p.injury?.designation).filter(Boolean))],fieldNames:[...new Set(rows.flatMap(p=>Object.keys(p).filter(k=>/injur|status|reserve|update/i.test(k))))],targets:rows.filter(p=>TARGETS.some(n=>String(p.longName||'').includes(n))).map(fields)};
   await store.setJSON('full-player-list-raw-v1',{capturedAt:out.capturedAt,players:JSON.parse(JSON.stringify(rows.map(fields)).split(apiKey).join('[redacted]'))});
  }
 }catch(_){out={status:'FAILED',reason:'Full player-list request unavailable or unexpected response'};}
 const safe=JSON.parse(JSON.stringify(out).split(apiKey).join('[redacted]'));await store.setJSON(KEY,safe);return safe;
}
module.exports={fullListAudit};
