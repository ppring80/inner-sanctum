#!/usr/bin/env node
'use strict';
// Read-only production smoke checks. No authenticated calls or refresh triggers.
const base=(process.env.SANCTUM_BASE_URL||'https://theinnersanctum.xyz').replace(/\/$/,'');
const now=new Date(), start=Date.UTC(2026,8,15,6);
const week=Math.max(1,Math.min(18,now.getTime()<start?1:Math.floor((now.getTime()-start)/(7*86400000))+2));
let failures=0;
async function check(label,path,validate){
  try{
    const r=await fetch(base+path,{signal:AbortSignal.timeout(15000),headers:{'User-Agent':'SanctumReliabilityGate/1.0'}});
    if(!r.ok)throw Error('HTTP '+r.status);
    await validate(r);
    console.log('PASS '+label);
  }catch(e){failures++;console.error('FAIL '+label+': '+e.message);}
}
(async()=>{
  for(const page of ['/','/sanctum','/weekly-rankings']){
    await check('page '+page,page,async r=>{
      const body=await r.text();
      if(!/<html|<!doctype/i.test(body)||body.length<500)throw Error('invalid HTML');
    });
  }
  if(now.getUTCFullYear()===2026 && now>=new Date('2026-09-01T00:00:00Z')&&now<new Date('2027-01-10T00:00:00Z')){
    await check('QB Week '+week+' half-PPR','/.netlify/functions/weekly-sage-qb-leaderboard?season=2026&week='+week+'&seasonType=reg&scoring=half',async r=>{
      const d=await r.json();
      if(Number(d.week)!==week)throw Error('wrong week '+d.week);
      if(!Array.isArray(d.leaderboard)||!d.leaderboard.length)throw Error('empty leaderboard');
      if(d.scoring&&!/half/i.test(d.scoring))throw Error('wrong scoring '+d.scoring);
      if(Array.isArray(d.failures)&&d.failures.length)throw Error(d.failures.length+' player scoring failures');
    });
  }
  console.log('Reliability gate: '+(failures?'FAIL':'PASS'));
  if(failures)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
