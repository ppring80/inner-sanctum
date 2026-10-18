'use strict';
const assert = require('assert');
const Module = require('module');
const { hash } = require('../netlify/functions/_super-sage-shadow-llm');
const original = Module._load;
let paidCalls = 0,storeAccess=0;
Module._load = function(request, parent, isMain) {
 if (request === '@modelcontextprotocol/server') return { createMcpHandler: () => {}, McpServer: class { constructor() { this.tools = {}; } registerTool(name, options, callback) { this.tools[name] = { options, callback }; } } };
 if (request === '@netlify/blobs') return { getStore: () => {storeAccess++;return { marker: 'private-store' };} };
 if (request === './_super-sage-shadow-fast-review.js') return { runFastReview: async args => { paidCalls++; assert.strictEqual(args.store.marker, 'private-store'); assert.strictEqual(args.ownerHash, hash('linked-owner')); return { status: 'REVIEW_READY', rawText: 'exact model reply' }; } };
 return original.call(this, request, parent, isMain);
};
const { buildServer } = require('../netlify/functions/chatgpt-mcp')._test;
const previousGate = process.env.SUPER_SAGE_REVIEWER_PEEPHOLE;
(async () => {
 const args = { decisionId: 'a'.repeat(64), mode: 'focused' };
 delete process.env.SUPER_SAGE_REVIEWER_PEEPHOLE;
 const closed = buildServer({}, { snapshotKey: 'linked-owner' });
 assert.strictEqual(closed.tools.run_shadow_llm_review.options.annotations.readOnlyHint, false);
 assert.strictEqual(closed.tools.get_shadow_decision.options.annotations.readOnlyHint, true);
 assert.strictEqual((await closed.tools.run_shadow_llm_review.callback(args)).isError, true);
 process.env.SUPER_SAGE_REVIEWER_PEEPHOLE = 'true';
 assert.strictEqual((await buildServer({}, null).tools.run_shadow_llm_review.callback(args)).isError, true);
 assert.strictEqual(paidCalls, 0);
 const result = await buildServer({}, { snapshotKey: 'linked-owner', rookieInvocationTiming: { authorizationMs: 3, analyticsMs: 4 }, rookieInvocationStart: performance.now() }).tools.run_shadow_llm_review.callback(args);
 assert.strictEqual(result.structuredContent.invocationTiming.authorizationMs, 3); assert.strictEqual(result.structuredContent.invocationTiming.analyticsMs, 4); assert.ok(result.structuredContent.invocationTiming.reviewCallMs >= 0); assert.ok(!('invocationTiming' in result.structuredContent.review));
 assert.ok(result.content[0].text.length < 200); assert.ok(!result.content[0].text.includes('exact model reply'));
 assert.strictEqual(paidCalls, 1); assert.strictEqual(result.structuredContent.review.rawText, 'exact model reply');
 const accesses=storeAccess;
 for(const auth of [null,{snapshotKey:'linked-owner'}]){const server=buildServer({},auth);const blocked=await server.tools.run_shadow_llm_review.callback({decisionId:args.decisionId,mode:'full'});assert.strictEqual(blocked.structuredContent.error,'full_lineup_generation_retired');assert.strictEqual(blocked.structuredContent.providerInvoked,false);assert.strictEqual(blocked.isError,true);assert.match(blocked.content[0].text,/includeRookieSecondOpinion=true/);assert.match(server.tools.run_shadow_llm_review.options.description,/INTERNAL BENCHMARK ONLY/);}
 assert.strictEqual(storeAccess,accesses,'retired full route must not touch storage, queue or budget');assert.strictEqual(paidCalls,1,'retired full route must not generate');
 console.log('Private LLM tool: deployed gate, OAuth ownership, honest write annotation, exact model output; read-only peephole preserved.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { Module._load = original; if (previousGate === undefined) delete process.env.SUPER_SAGE_REVIEWER_PEEPHOLE; else process.env.SUPER_SAGE_REVIEWER_PEEPHOLE = previousGate; });
