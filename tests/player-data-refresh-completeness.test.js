'use strict';
const assert=require('assert'),Module=require('module'),original=Module._load;
let writes=[],reserved=[];
Module._load=function(id,parent,...args){
 if(id==='@netlify/blobs')return{connectLambda(){},getStore(){return{get:async()=>({players:{'0':{exp:'R'},old:{longName:'Old Reserve',injury:{designation:'IR'}}}}),setJSON:async(key,value)=>writes.push(value)}}};
 if(id==='./_tank01-daily-budget.js'&&parent.filename.endsWith('refresh-player-data.js'))return{requireTank01Budget:async(event,opts)=>{reserved.push(opts);return null;}};
 return original.call(this,id,parent,...args);
};
const {handler}=require('../netlify/functions/refresh-player-data');Module._load=original;
let fail=false,calls=0;
const players=Array.from({length:1280},(_,i)=>({playerID:String(i),longName:'Player '+i,pos:'WR',team:'T'+(i%32),isFreeAgent:'False',injury:{designation:i===0?'Injured Reserve':''}}));
global.fetch=async url=>{calls++;assert(new URL(url).pathname.endsWith('getNFLPlayerList'));return{ok:!fail,status:503,json:async()=>({statusCode:200,body:players})};};
(async()=>{let r=await handler({});assert.equal(r.statusCode,200);assert.equal(writes.length,1);assert.equal(calls,1);assert.equal(reserved[0].calls,1);assert.equal(writes[0].availabilityMode,'tank01-full-player-list-v1');assert.equal(writes[0].players['0'].injury.designation,'IR');assert.equal(writes[0].players['0'].exp,'R','rookie display metadata survives omission without carrying old availability');assert(!writes[0].players.old,'obsolete reserve records are not merged into a current full feed');fail=true;r=await handler({});assert.equal(r.statusCode,502);assert.equal(writes.length,1,'failed refresh preserves complete cache');console.log('Full Tank01 player availability: one guarded call, explicit IR retained, stale records not carried forward, provider failure preserves cache.');})().catch(e=>{console.error(e);process.exitCode=1});
