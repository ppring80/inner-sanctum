'use strict';
const assert=require('assert');const Module=require('module');const original=Module._load;
let writes=[];
Module._load=function(id,parent,...args){
 if(id==='@netlify/blobs')return {connectLambda(){},getStore(){return {setJSON:async(key,value)=>writes.push(value)}}};
 if(id==='./_tank01-daily-budget.js' && parent.filename.endsWith('refresh-player-data.js'))return {requireTank01Budget:async()=>null};
 return original.call(this,id,parent,...args);
};
const {handler}=require('../netlify/functions/refresh-player-data');Module._load=original;
let fail=false;
global.fetch=async url=>{const u=new URL(url);if(u.pathname.endsWith('getNFLTeams'))return {ok:true,json:async()=>({body:Array.from({length:32},(_,i)=>({teamAbv:'T'+i}))})};const team=u.searchParams.get('teamAbv');return {ok:!(fail&&team==='T0'),status:503,json:async()=>({body:{roster:Array.from({length:40},(_,i)=>({playerID:team+'-'+i,longName:'Player '+i,pos:'WR',team}))}})};};
(async()=>{let r=await handler({});assert.equal(r.statusCode,200);assert.equal(JSON.parse(r.body).cached,true);assert.equal(writes.length,1);assert.equal(writes[0].teamsSucceeded,32);fail=true;r=await handler({});assert.equal(r.statusCode,502);assert.equal(writes.length,1,'a partial refresh must preserve the complete cache');console.log('Player availability preserves complete cache on partial provider failure.');})().catch(e=>{console.error(e);process.exitCode=1});
