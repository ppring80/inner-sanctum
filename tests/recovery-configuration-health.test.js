'use strict';
const assert=require('node:assert/strict');
const {refreshDiagnostics}=require('../netlify/functions/_weekly-refresh-diagnostics');
const {verifyRecoveryHealth}=require('../scripts/diagnose-weekly-refresh');
(async()=>{
 const names=['CONTEXT','TANK01_REFRESH_TOKEN','TANK01_API_KEY'];
 const saved=Object.fromEntries(names.map(name=>[name,process.env[name]]));
 const jobs=[{job:'refresh-player-data',store:'player-data',ready:true},{job:'refresh-weekly-projections',store:'weekly-projections',ready:true}];
 const getStore=()=>({get:async()=>null,setJSON(){throw Error('Unexpected write');}});
 try{
  process.env.CONTEXT='production';process.env.TANK01_REFRESH_TOKEN='synthetic-signing-value';process.env.TANK01_API_KEY='synthetic-provider-value';
  const healthy=await refreshDiagnostics(getStore,jobs);
  assert.deepEqual(verifyRecoveryHealth(healthy),{status:'PASS',blockers:[]});
  assert(!JSON.stringify(healthy).includes('synthetic-'),'Diagnostic must not expose credential values');
  process.env.CONTEXT='deploy-preview';
  assert(verifyRecoveryHealth(await refreshDiagnostics(getStore,jobs)).blockers.includes('production_context'));
  process.env.CONTEXT='production';delete process.env.TANK01_REFRESH_TOKEN;
  assert.equal(verifyRecoveryHealth(await refreshDiagnostics(getStore,jobs)).status,'PASS','Existing API-key signing fallback remains supported');
  delete process.env.TANK01_API_KEY;
  assert.deepEqual(verifyRecoveryHealth(await refreshDiagnostics(getStore,jobs)).blockers,['recovery_signing_configuration','provider_configuration']);
  for(const job of jobs){const data={...healthy,jobs:healthy.jobs.map(row=>row.job===job.job?{...row,ready:false}:row)};assert(verifyRecoveryHealth(data).blockers.includes(job.job));}
  assert.equal(verifyRecoveryHealth({...healthy,jobs:[]}).status,'FAIL');
  assert.equal(verifyRecoveryHealth({...healthy,runtime:undefined}).status,'FAIL','Missing diagnostics cannot silently pass');
  assert.deepEqual(verifyRecoveryHealth({...healthy,jobs:[...healthy.jobs,{job:'refresh-role-evidence',ready:false}]}),{status:'PASS',blockers:[]},'Supplementary degradation must not become a core failure');
 }finally{for(const name of names){if(saved[name]===undefined)delete process.env[name];else process.env[name]=saved[name];}}
 console.log('PASS: read-only recovery monitoring detects preview context, missing configuration and stale independent feeds without exposing credentials or changing recovery.');
})().catch(error=>{console.error(error);process.exitCode=1;});
