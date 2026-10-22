'use strict';
// Read-only operator diagnostics. No provider calls, reservations or state writes.
const budget=require('./_tank01-daily-budget');
const {canRetry}=require('./_weekly-refresh-recovery');
async function refreshDiagnostics(getStore,rows,now=Date.now()){
 const store=getStore({name:budget.STORE_NAME});
 const days=await Promise.all([0,1].map(async offset=>{
  const day=new Date(now-offset*86400000).toISOString().slice(0,10);
  const ledger=await store.get('day:'+day,{type:'json'});
  if(!ledger)return {day,available:false};
  // Limits in a saved ledger are historical evidence; never apply today's
  // environment settings to reinterpret yesterday's limit.
  const total=Number(ledger.reserved||0),normal=Number(ledger.normalReserved??ledger.reserved??0);
  const limit=Number.isFinite(Number(ledger.limit))&&Number(ledger.limit)>0?Number(ledger.limit):null;
  const normalLimit=Number.isFinite(Number(ledger.normalLimit))&&Number(ledger.normalLimit)>0?Number(ledger.normalLimit):null;
  return {day,available:true,updatedAt:ledger.updatedAt||null,reserved:total,normalReserved:normal,injuryReserved:Number(ledger.injuryReserved||0),limit,normalLimit,
   totalExhausted:limit===null?null:total>=limit,normalExhausted:normalLimit===null?null:normal>=normalLimit,
   projectionReservations:Number(ledger.jobs?.['refresh-weekly-projections']||0)};
 }));
 const jobs=rows.filter(r=>['weekly-projections','sage-newswire','player-data'].includes(r.store)).map(r=>{
  const s=r.status||{};return {job:r.job,ready:r.ready,state:s.status||'pending',day:s.day||null,attempts:s.attempts??null,attemptLimit:s.attemptLimit??null,
   canRetry:canRetry(r.status,now),leaseUntil:s.leaseUntil||null,retryAfter:s.retryAfter||null,lastAttempt:s.startedAt||null,finishedAt:s.finishedAt||null,statusCode:s.statusCode??null,error:s.error||null};
 });
 return {checkedAt:new Date(now).toISOString(),budgetDays:days,jobs,historicalJobFailuresAvailable:false,
  limitation:'Job state holds only the latest run. A successful rollover can overwrite yesterday\'s failure; retained budget ledgers do not reconstruct the exact failed request.'};
}
module.exports={refreshDiagnostics};
