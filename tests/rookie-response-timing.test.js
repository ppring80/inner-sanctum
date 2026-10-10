'use strict';
const assert = require('assert');
const { finishRookieResponse } = require('../netlify/functions/_rookie-response-timing');
const timing = { requestId: 'diagnostic-id', handlerTotalMs: 120, mcpFetchMs: 80, responseReadMs: 5, postReviewMs: 7, scope: 'HANDLER_THROUGH_RESPONSE_READ', excludes: 'network_delivery_and_client_dispatch' };
const review = { rawText: 'An exact answer.\nWith a second line.', answer: { choice: 'B', confidence: 'MEDIUM' }, providerMs: 10563, validationErrors: ['saved-finding'] };
const message = { jsonrpc: '2.0', id: 42, result: { content: [{ type: 'text', text: 'Saved review' }], structuredContent: { review } } };
const original = JSON.stringify(message);
const response = finishRookieResponse({ body: original, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, timing });
const parsed = JSON.parse(response.body);
assert.strictEqual(parsed.id, 42); assert.deepStrictEqual(parsed.result.structuredContent.review, review);
assert.deepStrictEqual(parsed.result.structuredContent.responseTiming, timing);
assert.strictEqual(JSON.stringify(message), original); assert.ok(!('responseTiming' in review));
assert.strictEqual(response.headers['x-rookie-request-id'], timing.requestId);
assert.strictEqual(response.headers['access-control-allow-origin'], '*');
assert.ok(response.headers['server-timing'].includes('response_read;dur=5'));
const stream = `event: message\ndata: ${original}\n\nid: other\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\n`;
const streamed = finishRookieResponse({ body: stream, headers: { 'content-type': 'text/event-stream' }, timing });
const data = streamed.body.split('\n').find(line => line.startsWith('data: '));
assert.deepStrictEqual(JSON.parse(data.slice(6)).result.structuredContent.review, review);
assert.ok(streamed.body.includes('event: message\n')); assert.ok(streamed.body.endsWith('id: other\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\n'));
for (const body of ['not JSON', '{"jsonrpc":"2.0","id":42,"error":{"code":-32600}}']) {
 assert.strictEqual(finishRookieResponse({ body, headers: { 'content-type': 'application/json' }, timing }).body, body);
}
console.log('Rookie response timing: JSON/SSE protocol and saved answer preserved; delivery exclusion explicit.');
