'use strict';
const assert=require('node:assert/strict'),Module=require('node:module');
const original=Module._load,oldEnabled=process.env.OFFICIAL_CLUB_COLLECTION_ENABLED;
let connected=0,stores=0,runs=0,clubFailure=false,observations=null;
const summary=require('../netlify/functions/_club-availability-run').summarize;
Module._load=function(name,parent,main){
 if(name==='@netlify/blobs')return {connectLambda:()=>{connected++;},getStore:({name})=>{stores++;return {get:async key=>{
  if(name==='official-club-availability'){if(clubFailure)throw Error('Blob unavailable');return key==='observations'?observations:null;}
  if(key==='latest')return {checkedAt:new Date().toISOString(),records:[]};return {error:null};
 }};}};
 if(name==='./_tank01-refresh-guard')return {requireTank01RefreshAuthorization:()=>({statusCode:401})};
 if(name==='./_injury-workflow-auth')return {verifyWorkflowToken:async()=>false};
 if(name==='./_club-availability-run')return {STORE:'official-club-availability',summarize:summary,runCollection:async()=>{runs++;throw Error('Unexpected collection');}};
 if(name==='./_weekly-refresh-recovery.js')return {inspectJobs:async()=>[{job:'ready',week:5,ready:true}],resolveCurrentNFLWeek:()=>5};
 return original.call(this,name,parent,main);
};
(async()=>{
 try{
  const worker=require('../netlify/functions/refresh-club-availability-background');
  delete process.env.OFFICIAL_CLUB_COLLECTION_ENABLED;
  const disabled=await worker.handler({httpMethod:'POST'});assert.equal(JSON.parse(disabled.body).reason,'CLUB_COLLECTION_DISABLED');assert.equal(connected,0);assert.equal(stores,0);
  process.env.OFFICIAL_CLUB_COLLECTION_ENABLED='true';
  assert.equal((await worker.handler({httpMethod:'POST'})).statusCode,401);assert.equal(runs,0);assert.equal(stores,0);
  const status=require('../netlify/functions/weekly-sage-status');
  const healthy=await status.handler({httpMethod:'GET'}),body=JSON.parse(healthy.body);
  assert.equal(healthy.statusCode,200);assert.equal(body.injuryTransactions.fresh,true);assert.equal(body.clubAvailability.fresh,false);assert.equal(body.clubAvailability.coveragePassed,false);assert.equal(body.clubAvailability.requiredTeams,32);assert.equal(body.clubAvailability.customerReadsEnabled,false);
  assert.equal(body.clubAvailability.observations.freshRosterCoverage,false);
  assert.equal(body.clubAvailability.observations.freshTeams.length,0);
  const observedAt=new Date().toISOString();
  observations={teams:{BAL:{team:'BAL',season:new Date().getUTCFullYear(),asOf:observedAt,collectionHealthy:true,discoveryComplete:false,players:[{name:'Observed Back',team:'BAL',position:'RB',status:'IR',lastVerifiedStatus:'IR',observedAt,placementDate:null,conflicts:[],provenance:[{sourceUrl:'https://www.baltimoreravens.com/team/players-roster/',profileUrl:'https://www.baltimoreravens.com/team/players-roster/observed-back/',status:'IR'}]}]}}};
  const observed=JSON.parse((await status.handler({httpMethod:'GET'})).body);
  assert.deepEqual(observed.clubAvailability.observations.freshTeams,['BAL']);
  assert.equal(observed.clubAvailability.observations.teams[0].counts.IR,1);
  assert.equal(observed.clubAvailability.coveragePassed,false);
  assert.equal(observed.clubAvailability.customerReadsEnabled,false);
  assert.equal(runs,0,'Reading status never invokes collection');
  clubFailure=true;const unavailable=await status.handler({httpMethod:'GET'});
  assert.equal(unavailable.statusCode,200);assert.equal(JSON.parse(unavailable.body).ready,true);assert.equal(JSON.parse(unavailable.body).clubAvailability.fresh,false);assert.equal(runs,0);
  console.log('PASS: disabled worker does no work, unauthorized requests cannot collect, NFL green cannot imply fallback activation, optional coverage failure preserves weekly status.');
 }finally{Module._load=original;if(oldEnabled===undefined)delete process.env.OFFICIAL_CLUB_COLLECTION_ENABLED;else process.env.OFFICIAL_CLUB_COLLECTION_ENABLED=oldEnabled;}
})().catch(e=>{console.error(e);process.exitCode=1;});
