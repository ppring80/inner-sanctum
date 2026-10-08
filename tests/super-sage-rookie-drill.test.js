'use strict';
const assert = require('assert');
const { hash } = require('../netlify/functions/_super-sage-shadow-llm');
const { VOICE } = require('../netlify/functions/_super-sage-shadow-voice');
const { CASES, VERSION, buildCase, runNextDrill } = require('../netlify/functions/_super-sage-rookie-drill');
const ownerHash=hash('owner'), decisionId='d'.repeat(64);
const names=[['Chris Godwin Jr.','WR'],['Jakobi Meyers','WR'],['Terry McLaurin','WR'],['Courtland Sutton','WR'],['Blake Corum','RB'],['Saquon Barkley','RB']];
const packet={request:{week:5},players:names.map(([name,position],i)=>({name,position,facts:[{field:'standing',value:{tier:'FLEX'}},{field:'availability',value:{unavailable:false,status:name==='Terry McLaurin'?'Q':'ACTIVE'}},{field:'projection',value:{points:8+i}},{field:'establishedRole',value:{opportunities:4}},{field:'stateChanges',value:[]}]}))};
const frozenEvidence={packet,evidenceHash:hash(JSON.stringify(packet))}, before=JSON.stringify(frozenEvidence);
const data=new Map([[`evidence/${decisionId}/${ownerHash}`,{ownerHash,frozenEvidence}]]);
const store={get:async k=>data.get(k),setJSON:async(k,v,o={})=>{if(o.onlyIfNew&&data.has(k))return{modified:false};data.set(k,v);return{modified:true};}};
let calls=0;
const args={store,decisionId,ownerHash,apiKey:'synthetic',fetchImpl:async(_url,options)=>{
 calls++;const request=JSON.parse(options.body),p=JSON.parse(request.messages[0].content);assert.strictEqual(request.model,'claude-sonnet-4-6');assert.strictEqual(request.tools[0].strict,true);
 const ablation=p.scope==='SYNTHETIC_EVIDENCE_ABLATION';
 const factIds=p.players.flatMap(p=>p.facts.slice(0,1).map(f=>f.factId));
 assert.ok(request.tools[0].input_schema.required.includes('explanationSentences'));
 assert.strictEqual(request.max_tokens,550);assert.strictEqual(request.tools[0].input_schema.properties.explanationSentences.maxItems,undefined);assert.strictEqual(request.tools[0].input_schema.properties.explanationSentences.minItems,1);
 const texts=ablation?['No call: essential availability and role evidence is absent.','A supported comparison needs more evidence.','Neither candidate has supplied facts to support a choice.']:['Start the supported candidate.','Further evidence could change the choice.','The supplied evidence supports a qualified lean.'];
 const answer={selected:ablation?null:'A',confidence:'LOW',explanationSentences:texts.map((text,i)=>({text,factIds:[factIds[i%factIds.length]]})),caveat:'Availability and role must be verified.',reconsider:'Verified evidence arrives.'};
 return{ok:true,json:async()=>({model:request.model,stop_reason:'tool_use',content:[{type:'tool_use',name:'submit_decision',input:answer}]})};
}};
(async()=>{
 assert.ok(VOICE.includes('receivers catch passes'));
 const ablation=buildCase(frozenEvidence,CASES[3]);assert.strictEqual(ablation.packet.scope,'SYNTHETIC_EVIDENCE_ABLATION');assert.ok(!JSON.stringify(ablation).includes('Godwin'));assert.strictEqual(ablation.packet.players[0].facts.length,1);assert.strictEqual(JSON.stringify(frozenEvidence),before);
 const pair=buildCase(frozenEvidence,CASES[2]);assert.deepStrictEqual(pair.packet.eligiblePositions,['RB']);
 const concurrent=await Promise.all([runNextDrill(args),runNextDrill(args)]);assert.strictEqual(calls,1);assert.ok(concurrent.some(r=>r.status==='PENDING'));assert.ok(concurrent.some(r=>r.status==='REVIEW_READY'));
 for(let i=1;i<4;i++){const r=await runNextDrill(args);assert.strictEqual(r.caseId,CASES[i].id);assert.strictEqual(r.status,'REVIEW_READY');assert.strictEqual(r.rules.productionAuthority,false);if(i===3)assert.strictEqual(r.answer.selected,null);}
 const done=await runNextDrill(args);assert.strictEqual(done.status,'DRILL_COMPLETE');assert.strictEqual(done.cases.length,4);assert.strictEqual(calls,4);assert.strictEqual((await runNextDrill(args)).cached,true);assert.strictEqual(calls,4);
 const oldKey=`llm-drill/${VERSION}/close-call/${decisionId}/${ownerHash}`;
 const stored=data.get(oldKey);stored.answer.explanation='He is active and healthy for week 5.';
 const reassessed=await runNextDrill(args);const checked=reassessed.cases.find(c=>c.caseId==='close-call');assert.strictEqual(checked.status,'INVALID');assert.strictEqual(checked.storedStatus,'REVIEW_READY');assert.strictEqual(data.get(oldKey).status,'REVIEW_READY');assert.strictEqual(calls,4);
 assert.strictEqual([...data.keys()].filter(k=>k.startsWith(`llm-drill-budget/${VERSION}/`)).length,4);assert.ok(!data.has('llm-fast-budget/2026-10-08'));
 const denied=await runNextDrill({...args,ownerHash:hash('other')});assert.strictEqual(denied.error,'owned_frozen_evidence_unavailable');assert.strictEqual(calls,4);
 console.log('Rookie drill: four bounded independent cases, owned immutable evidence, explicit synthetic ablation, position eligibility, no double spend, cached completion, no authority. Provider mocked.');
})().catch(e=>{console.error(e);process.exitCode=1;});
