'use strict';
const assert = require('assert');
const Module = require('module');
const { runReview, buildEvidence, hash, signJob, verifyJob, VERSION } = require('../netlify/functions/_super-sage-shadow-llm');
const now = new Date('2026-10-08T02:00:00Z'), decisionId = 'a'.repeat(64), ownerHash = hash('owner'), apiKey = 'synthetic-key';
const frozenEvidence = buildEvidence({ decisionId, request: {}, slots: [{ slotLabel: 'RB', eligiblePositions: ['RB'], starter: { name: 'A', position: 'RB', standing: { tier: 'START' } } }] });
const makeStore = () => { const data = new Map([[`evidence/${decisionId}/${ownerHash}`, { ownerHash, frozenEvidence }]]); return { data, get: async key => data.get(key), setJSON: async (key, value, options={}) => { if (options.onlyIfNew && data.has(key)) return { modified: false }; data.set(key,value); return { modified: true }; } }; };
const body = JSON.stringify({ decisionId, ownerHash, issuedAt: now.getTime() });
assert.strictEqual(verifyJob(body, signJob(body,apiKey), apiKey, now.getTime()), true);
for (const [b,s,k,t] of [[body+' ',signJob(body,apiKey),apiKey,now.getTime()],[body,signJob(body,apiKey),'wrong',now.getTime()],[body,signJob(body,apiKey),apiKey,now.getTime()+300001],[body,'wrong',apiKey,now.getTime()]]) assert.strictEqual(verifyJob(b,s,k,t),false);
(async () => {
 const store=makeStore(); let enqueues=0;
 const args={store, decisionId, ownerHash, apiKey, now, fetchImpl:async (url,options)=>{ enqueues++; assert.strictEqual(url,'https://theinnersanctum.xyz/.netlify/functions/super-sage-rookie-review-background'); assert.strictEqual(verifyJob(options.body, options.headers['x-rookie-signature'],apiKey,now.getTime()),true); assert.ok(!options.body.includes(apiKey)); assert.ok(!options.body.includes('standing')); return {status:202}; }};
 const results=await Promise.all([runReview(args),runReview(args)]); assert.strictEqual(enqueues,1); assert.ok(results.every(r=>r.status==='QUEUED'));
 const completed={status:'REVIEW_READY',rawText:'exact answer'};store.data.set(`llm/${VERSION}/${decisionId}/${ownerHash}`,completed);assert.deepStrictEqual(await runReview(args),completed);assert.strictEqual(enqueues,1);
 const capped=makeStore();capped.data.set('llm-budget/2026-10-08',{});assert.strictEqual((await runReview({...args,store:capped})).error,'daily_model_call_limit');assert.strictEqual(enqueues,1);
 const failed=await runReview({...args,store:makeStore(),fetchImpl:async()=>({status:500})});assert.strictEqual(failed.error,'review_queue_failed');
 const original=Module._load;let executions=0,connections=0;
 Module._load=function(request,parent,isMain){if(request==='@netlify/blobs') return {connectLambda:()=>connections++,getStore:()=>store};if(request==='./_super-sage-shadow-llm.js') return {verifyJob,executeReview:async args=>{executions++;assert.strictEqual(args.ownerHash,ownerHash);}};return original.call(this,request,parent,isMain);};
 const worker=require('../netlify/functions/super-sage-rookie-review-background');Module._load=original;
 const oldGate=process.env.SUPER_SAGE_REVIEWER_PEEPHOLE,oldKey=process.env.ANTHROPIC_API_KEY;
 try {process.env.SUPER_SAGE_REVIEWER_PEEPHOLE='true';process.env.ANTHROPIC_API_KEY=apiKey;
 const event={httpMethod:'POST',body:JSON.stringify({decisionId,ownerHash,issuedAt:Date.now()}),headers:{}};
 assert.strictEqual((await worker.handler(event)).statusCode,401);assert.strictEqual(executions,0);assert.strictEqual(connections,0);
 event.headers['x-rookie-signature']=signJob(event.body,apiKey);assert.strictEqual((await worker.handler(event)).statusCode,200);assert.strictEqual(executions,1);
 process.env.SUPER_SAGE_REVIEWER_PEEPHOLE='false';assert.strictEqual((await worker.handler(event)).statusCode,401);assert.strictEqual(executions,1);
 } finally {if(oldGate===undefined)delete process.env.SUPER_SAGE_REVIEWER_PEEPHOLE;else process.env.SUPER_SAGE_REVIEWER_PEEPHOLE=oldGate;if(oldKey===undefined)delete process.env.ANTHROPIC_API_KEY;else process.env.ANTHROPIC_API_KEY=oldKey;}
 console.log('Rookie background tests passed: signed jobs, stale/tampered rejection, gated worker, atomic queue dedup, cap preservation, exact result polling, no key or evidence in job payload.');
})().catch(e=>{console.error(e);process.exitCode=1;});
