'use strict';
const {connectLambda,getStore}=require('@netlify/blobs');
const roles=require('./_role-event-ingestion');
const {collectRoleSources}=require('./_role-report-collection');
const REFRESH_MS=6*3600000;
async function refresh({getStore,collect=collectRoleSources,season,now=Date.now()}){
 const store=getStore({name:roles.STORE}),previous=await store.get('season:'+season,{type:'json'});
 const age=now-Date.parse(previous?.dedicatedCollection?.checkedAt);
 if(Number.isFinite(age)&&age>=0&&age<REFRESH_MS)return {cached:true,skipped:true};
 const playerCache=await getStore({name:'player-data'}).get('playerData',{type:'json'});
 const identityAge=now-Date.parse(playerCache?.updatedAt);
 if(!Number.isFinite(identityAge)||identityAge<0||identityAge>=8*3600000||!Object.keys(playerCache?.players||{}).length)throw Error('Fresh player identity required; source collection not attempted.');
 const {items,collection}=await collect(undefined,{previousCollection:previous?.dedicatedCollection,now});
 // Total outage never replaces the last successful collection/evidence.
 if(!collection.indexesSucceeded)throw Error('No role sources accessible; prior evidence preserved.');
 return roles.ingestRoleReports({store,items,playerCache,season,now,collection});
}
exports.handler=async event=>{
 // Only the verified background builder invokes this worker. No public/manual
 // refresh path, provider reservation, or new cron endpoint.
 if(event.httpMethod)return {statusCode:401};
 connectLambda(event);
 const season=Number(event.queryStringParameters?.season||new Date().getUTCFullYear());
 if(!Number.isInteger(season)||season<2020||season>2100)return {statusCode:400};
 try{return {statusCode:200,body:JSON.stringify(await refresh({getStore,season}))};}
 catch(error){console.error('SAGE_ROLE_COLLECTION_FAILED',error.message);return {statusCode:502,body:JSON.stringify({cached:false,error:error.message})};}
};
exports.refresh=refresh;exports.REFRESH_MS=REFRESH_MS;
