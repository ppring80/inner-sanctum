'use strict';
// Cache-only projection diagnostics and reuse; never invokes the provider.
const {connectLambda}=require('@netlify/blobs');
const {readWeeklyProjections}=require('./_weekly-projections');
const {resolveCurrentNFLWeek}=require('./_current-nfl-week');
exports.handler=async event=>{
 connectLambda(event);
 const q=event.queryStringParameters||{},season=Number(q.season||new Date().getUTCFullYear()),week=Number(q.week||resolveCurrentNFLWeek(new Date(),season)),scoring=q.scoring||'half-ppr';
 const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
 if(!Number.isInteger(week)||week<1||week>18)return {statusCode:400,headers,body:JSON.stringify({error:'A regular-season week from 1–18 is required.'})};
 const data=await readWeeklyProjections(season,week,scoring);
 return {statusCode:data?200:503,headers,body:JSON.stringify(data||{error:'Current weekly projection cache is unavailable.',season,week})};
};
