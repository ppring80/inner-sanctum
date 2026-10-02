'use strict';
const assert=require('node:assert/strict');
const Module=require('module');
const load=Module._load;
let fullAccess=false,authThrows=false;
const snapshot={season:String(new Date().getUTCFullYear()),computedAt:new Date().toISOString(),currentWeek:3,previousWeek:2,risers:[{longName:'Riser One'},{longName:'Riser Two'}],fallers:[{longName:'Faller One'},{longName:'Faller Two'}]};
Module._load=function(request,parent,isMain){
 if(request==='@netlify/blobs')return {connectLambda(){},getStore(){return {get:async()=>snapshot}}};
 if(request==='./verify-session'&&parent?.filename.endsWith('/get-risers-fallers.js'))return {handler:async()=>{if(authThrows)throw Error('session unavailable');return {statusCode:200,body:JSON.stringify({fullAccess})}}};
 return load.apply(this,arguments);
};
const {handler}=require('../netlify/functions/get-risers-fallers');
Module._load=load;
(async()=>{
 const event={httpMethod:'GET',headers:{}};
 let response=await handler(event),body=JSON.parse(response.body);
 assert.equal(response.statusCode,200);assert.equal(body.fullAccess,false);assert.equal(body.preview,true);
 assert.deepEqual(body.risers,snapshot.risers.slice(0,1));assert.deepEqual(body.fallers,snapshot.fallers.slice(0,1));
 fullAccess=true;response=await handler(event);body=JSON.parse(response.body);
 assert.equal(response.statusCode,200);assert.equal(body.fullAccess,true);assert.equal(body.preview,false);
 assert.deepEqual(body.risers,snapshot.risers);assert.deepEqual(body.fallers,snapshot.fallers);
 authThrows=true;response=await handler(event);body=JSON.parse(response.body);
 assert.equal(response.statusCode,200);assert.equal(body.fullAccess,false);assert.equal(body.fallers.length,1);
 console.log('PASS: real trends handler returns both free preview lists, full paid lists, and safe preview on session failure.');
})().catch(error=>{console.error(error);process.exitCode=1;});
