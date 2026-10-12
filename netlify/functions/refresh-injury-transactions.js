'use strict';
const {connectLambda,getStore}=require('@netlify/blobs');
const {requireTank01RefreshAuthorization}=require('./_tank01-refresh-guard');
const {STORE,mergeTransactions}=require('./_injury-transactions');
exports.handler=async event=>{
  const denied=requireTank01RefreshAuthorization(event);
  if(denied){const authorization=Object.entries(event.headers||{}).find(([key])=>key.toLowerCase()==='authorization')?.[1]||'';const token=/^Bearer\s+(.+)$/i.exec(authorization)?.[1];if(!await require('./_injury-workflow-auth').verifyWorkflowToken(token))return denied;}
  connectLambda(event);
  const now=new Date(),store=getStore({name:STORE}),previous=await store.get('latest',{type:'json'});
  if(previous&&now-Date.parse(previous.checkedAt)<50*60000)return {statusCode:200,body:JSON.stringify({cached:true,skipped:true,reason:'FRESH_CACHE',checkedAt:previous.checkedAt})};
  const lease=await store.getWithMetadata('refresh-lease',{type:'json'});
  if(lease?.data?.until>now.getTime())return {statusCode:202,body:JSON.stringify({skipped:true,reason:'REFRESH_IN_PROGRESS'})};
  const leaseOwner=require('node:crypto').randomUUID();
  const claimed=await store.setJSON('refresh-lease',{until:now.getTime()+5*60000,owner:leaseOwner},lease?{onlyIfMatch:lease.etag}:{onlyIfNew:true});
  if(!claimed.modified)return {statusCode:202,body:JSON.stringify({skipped:true,reason:'REFRESH_IN_PROGRESS'})};
  try{
    const months=[now,new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,1))];
    const sources=months.flatMap(date=>['reserve-list','other','signings'].map(category=>({year:date.getUTCFullYear(),month:date.getUTCMonth()+1,category,url:`https://www.nfl.com/transactions/league/${category}/${date.getUTCFullYear()}/${String(date.getUTCMonth()+1).padStart(2,'0')}`})));
    const registry=(await getStore({name:'player-data'}).get('playerData',{type:'json'}))?.players||{};
    const week=require('./_current-nfl-week').resolveCurrentNFLWeek(now,now.getUTCFullYear());
    const snapshotRows=(await Promise.all(['qb','rb','wr','te','k'].map(async pos=>{const cache=await getStore({name:pos+'-snapshot'}).get(`week:${now.getUTCFullYear()}:${week}:reg`,{type:'json'});return (cache?.population||[]).map(r=>({...r,position:pos.toUpperCase()}));}))).flat();
    let sourceRequests=0;const historicalWarnings=[];
    const records=(await Promise.all(sources.map(async s=>{
      try{return await require('./_official-transaction-pages').collectPages(s,{onRequest:()=>sourceRequests++});}
      catch(error){if((s.month!==now.getUTCMonth()+1||s.year!==now.getUTCFullYear())&&/pagination (loop|limit)/.test(error.message)){historicalWarnings.push(`Historical pagination incomplete: ${s.url}`);return error.partialRecords||[]; }throw error;}
    }))).flat();
    for(const r of records){const identities=[...Object.values(registry).map(p=>({name:p.longName,team:p.team,position:p.pos})),...snapshotRows].filter(p=>p.team===r.team&&require('./_injury-transactions').playerKey(p.name)===require('./_injury-transactions').playerKey(r.name));const positions=[...new Set(identities.map(p=>p.position).filter(Boolean))];if(!r.position&&positions.length===1)r.position=positions[0];}
    const merged=mergeTransactions(previous,records,now.toISOString());
    await store.setJSON('latest',{version:1,checkedAt:now.toISOString(),source:'NFL official transactions',historicalWarnings,records:merged.records,changes:[...(previous?.changes||[]),...merged.changes].slice(-200),lastChanges:merged.changes,sources:sources.map(s=>s.url)});
    await store.setJSON('health',{lastAttempt:now.toISOString(),lastSuccess:now.toISOString(),error:null,historicalWarnings,changes:merged.changes.length});
    return {statusCode:200,body:JSON.stringify({cached:true,checkedAt:now.toISOString(),records:merged.records.length,changes:merged.changes.length,sourceRequests,historicalWarnings,tank01Calls:0})};
  }catch(error){await store.setJSON('health',{lastAttempt:now.toISOString(),lastSuccess:previous?.checkedAt||null,error:error.message});return {statusCode:502,body:JSON.stringify({cached:false,error:error.message,previousCachePreserved:true})};}
  finally{try{const current=await store.getWithMetadata('refresh-lease',{type:'json'});if(current?.data?.owner===leaseOwner)await store.setJSON('refresh-lease',{until:0,owner:leaseOwner},{onlyIfMatch:current.etag});}catch{/* Lease expires naturally if release fails. */}}
};
