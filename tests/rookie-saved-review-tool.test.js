'use strict';
const assert = require('assert');
const Module = require('module');
const { hash } = require('../netlify/functions/_super-sage-shadow-llm');
const originalLoad = Module._load;
const previousGate = process.env.SUPER_SAGE_REVIEWER_PEEPHOLE;
const decisionId = 'a'.repeat(64), ownerHash = hash('linked-owner');
const packet = { players: [] };
const savedReview = { status: 'INVALID', rawText: 'exact saved output', requestId: 'saved-id', providerMs: 10563, validationErrors: ['saved-error'] };
let paidCalls = 0, writes = 0, responseMode = 'json';
Module._load = function(request, parent, isMain) {
 if (request === '@modelcontextprotocol/server') return {
  McpServer: class { constructor() { this.tools = {}; } registerTool(name, options, callback) { this.tools[name] = { options, callback }; } },
  createMcpHandler: make => ({ fetch: async request => {
   const envelope = await request.json();
   const server = make({ requestInfo: {} });
   const result = await server.tools[envelope.params.name].callback(envelope.params.arguments);
   const body = JSON.stringify({ jsonrpc: '2.0', id: envelope.id, result });
   return new Response(responseMode === 'sse' ? `event: message\ndata: ${body}\n\n` : body, { headers: { 'content-type': responseMode === 'sse' ? 'text/event-stream' : 'application/json' } });
  } })
 };
 if (request === '@netlify/blobs') return { connectLambda: () => {}, getStore: ({ name }) => ({
  get: async key => {
   if (name === 'chatgpt-oauth') return { expiresAt: Math.floor(Date.now()/1000) + 60, resource: 'https://theinnersanctum.xyz/.netlify/functions/chatgpt-mcp', scopes: ['inner_sanctum.league.read'], snapshotKey: 'linked-owner' };
   if (name === 'league-snapshots') return { leagueName: 'owned league' };
   if (key === `evidence/${decisionId}/${ownerHash}`) return { ownerHash, frozenEvidence: { packet, evidenceHash: hash(JSON.stringify(packet)) } };
   if (key === `llm-drill/rookie-fast-pair-v6-haiku/fresh-role-post232/${decisionId}/${ownerHash}`) return savedReview;
   return null;
  }, setJSON: () => { writes++; throw Error('unexpected write'); }
 }) };
 if (request === './_sage-funnel-analytics.js') return { recordSageFunnelEvent: async () => {} };
 if (request === './_super-sage-shadow-fast-review.js') return { runFastReview: async () => { paidCalls++; throw Error('unexpected paid call'); } };
 return originalLoad.call(this, request, parent, isMain);
};
const { handler, _test: { buildServer } } = require('../netlify/functions/chatgpt-mcp');
(async () => {
 delete process.env.SUPER_SAGE_REVIEWER_PEEPHOLE;
 const closed = buildServer({}, { snapshotKey: 'linked-owner' }).tools.get_saved_rookie_review;
 assert.strictEqual(closed.options.annotations.readOnlyHint, true);
 assert.strictEqual((await closed.callback({ decisionId })).isError, true);
 process.env.SUPER_SAGE_REVIEWER_PEEPHOLE = 'true';
 assert.strictEqual((await buildServer({}, null).tools.get_saved_rookie_review.callback({ decisionId })).isError, true);
 const envelope = { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'get_saved_rookie_review', arguments: { decisionId } } };
 const event = { httpMethod: 'POST', headers: { authorization: 'Bearer test-token', 'content-type': 'application/json', host: 'theinnersanctum.xyz' }, body: JSON.stringify(envelope) };
 for (responseMode of ['json', 'sse']) {
  const response = await handler(event);
  assert.strictEqual(response.statusCode, 200);
  const parsed = JSON.parse(responseMode === 'sse' ? response.body.split('\n').find(line => line.startsWith('data: ')).slice(6) : response.body);
  assert.deepStrictEqual(parsed.result.structuredContent.review, savedReview);
  const timing = parsed.result.structuredContent.responseTiming;
  assert.strictEqual(timing.scope, 'HANDLER_THROUGH_RESPONSE_READ');
  assert.ok(timing.handlerTotalMs >= timing.mcpFetchMs); assert.ok(timing.postReviewMs >= 0);
  assert.strictEqual(response.headers['x-rookie-request-id'], timing.requestId);
 }
 const unauthorized = await handler({ ...event, headers: { 'content-type': 'application/json' } });
 assert.strictEqual(unauthorized.statusCode, 401);
 assert.ok(!unauthorized.headers['x-rookie-request-id']);
 assert.strictEqual(paidCalls, 0); assert.strictEqual(writes, 0);
 console.log('Saved Rookie tool: private OAuth gate, no generation/writes, real handler JSON/SSE response timings.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
 Module._load = originalLoad;
 if (previousGate === undefined) delete process.env.SUPER_SAGE_REVIEWER_PEEPHOLE; else process.env.SUPER_SAGE_REVIEWER_PEEPHOLE = previousGate;
});
