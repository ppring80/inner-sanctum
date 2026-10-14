'use strict';
const {connectLambda,getStore}=require('@netlify/blobs');
const {STORE,runCollection}=require('./_club-availability-run');
exports.handler=async event=>{
 if(process.env.OFFICIAL_CLUB_COLLECTION_ENABLED!=='true')return {statusCode:200,body:JSON.stringify({skipped:true,reason:'CLUB_COLLECTION_DISABLED'})};
 if(event.httpMethod!=='POST')return {statusCode:405};
 const denied=require('./_tank01-refresh-guard').requireTank01RefreshAuthorization(event);
 if(denied){
  const authorization=Object.entries(event.headers||{}).find(([key])=>key.toLowerCase()==='authorization')?.[1]||'';
  const token=/^Bearer\s+(.+)$/i.exec(authorization)?.[1];
  if(!await require('./_injury-workflow-auth').verifyWorkflowToken(token))return denied;
 }
 connectLambda(event);
 const previous=await getStore({name:require('./_injury-transactions').STORE}).get('latest',{type:'json'});
 const result=await runCollection({store:getStore({name:STORE}),adapters:require('./_club-availability-adapters').adapters,previousRecords:previous?.records||[],season:new Date().getUTCFullYear(),rosterFirst:true});
 return {statusCode:200,body:JSON.stringify({runId:result.runId||null,skipped:result.skipped||false,requests:result.requests||0,coveragePassed:result.summary?.coveragePassed||false,customerReadsEnabled:false,tank01Calls:0,anthropicCalls:0})};
};
