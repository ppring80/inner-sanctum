"use strict";
const assert=require("assert");
const fs=require("fs");
const path=require("path");
const src=fs.readFileSync(path.join(__dirname,"../netlify/functions/chatgpt-mcp.js"),"utf8");
assert.ok(src.includes('getStore({ name: "super-sage-shadow-lab" })'),"private shadow lab store required");
assert.ok(src.includes("decision/${record.decisionId}"),"lab key must use immutable production decision ID");
assert.ok(src.includes("{ onlyIfNew: true }"),"shadow lab must be append/create-only for a decision ID");
assert.ok(src.includes("customerVisible: false"),"shadow artifact must be private");
assert.ok(src.includes("productionAuthority: false"),"shadow artifact must have zero production authority");
assert.ok(src.includes("canChangeCustomerDecision: false"),"shadow cannot change customer call");
assert.ok(src.includes("outcomeDataAllowed: false"),"shadow lab cannot admit outcome data");
assert.ok(src.includes("automaticPromotionAllowed: false"),"shadow lab cannot auto-promote");
assert.ok(src.includes('console.error("Super SAGE shadow lab write failed:"'),"lab persistence failure must be caught/non-blocking");
const persist=src.indexOf("PRIVATE SHADOW LAB");
const present=src.indexOf("starters = toMcpStartersFromRecord(record)",persist);
assert.ok(persist>=0&&present>persist,"private persistence must not replace the existing customer presenter path");
// Exercise the actual MCP persistence block with an in-memory store. Verify
// lossless serialization, repeated slots, create-only options and an outage.
const {buildAutomaticShadowRecord}=require('../netlify/functions/_super-sage-live-shadow-adapter.js');
const {buildLiveShadowComparison}=require('../netlify/functions/_super-sage-live-shadow.js');
const record={evidenceType:'super-sage-lineup-decision',decisionId:'raw-shadow-regression',decisionScope:'START_SIT',request:{season:2026,week:5,scoring:'half'},slots:[1,2].map(n=>({slotLabel:'RB',starter:{name:'Starter '+n,standing:{tier:'START'}},comparator:{name:'Alternative '+n},confidence:{label:'Limited'},decisionState:'DECIDED'}))};
const raw=buildAutomaticShadowRecord(record);
const superSage={shadowRecord:raw,shadowComparison:buildLiveShadowComparison({season:2026,week:5,scoring:'half',productionRecord:record,shadowRecord:raw})};
const block=src.slice(src.indexOf('if (superSage.shadowComparison',persist),present);
const run=new Function('getStore','superSage','record','resolvedSeason','resolvedWeek','resolvedScoring','console','return (async () => {'+block+'})()');
(async()=>{
  let saved;
  await run(({name})=>{assert.strictEqual(name,'super-sage-shadow-lab');return {async setJSON(key,value,options){saved={key,value:JSON.parse(JSON.stringify(value)),options};}};},superSage,record,2026,5,'half',console);
  assert.deepStrictEqual(saved.value.shadowRecord,raw,'raw rationale and evidence must persist unchanged');
  assert.strictEqual(saved.value.shadowRecord.slots.length,2,'repeated slot labels must survive in raw record');
  assert.ok(saved.value.shadowRecord.slots.every(s=>s.shadow.rationale&&Array.isArray(s.shadow.evidenceUsed)));
  assert.deepStrictEqual(saved.options,{onlyIfNew:true});
  assert.strictEqual(saved.key,'decision/'+record.decisionId);
  let logged=false;
  await run(()=>({async setJSON(){throw new Error('store outage');}}),superSage,record,2026,5,'half',{error(){logged=true;}});
  assert.ok(logged,'failed writes must remain non-blocking');
  console.log('Private Super SAGE raw shadow persistence: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
