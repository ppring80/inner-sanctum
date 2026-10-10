'use strict';
// Rookie provider phase timing: where a provider wait ends is recorded instead
// of one combined number. Diagnostics only: no prompt, schema, evidence, model,
// token limit or deadline change. Provider fully mocked; no paid call.
const assert = require('node:assert/strict');
const { callProvider, requestFingerprint } = require('../netlify/functions/_super-sage-shadow-fast-review');

const KEY = 'sk-ant-test-SECRET-key';
const requestBody = { model: 'claude-sonnet-4-6', max_tokens: 750, system: 'SYSTEM PROMPT', messages: [{ role: 'user', content: JSON.stringify({ players: [{ name: 'Private League Player', facts: [] }] }) }],
  tools: [{ name: 'submit_decision', description: 'd', input_schema: { type: 'object', properties: { selected: { type: 'string' } } }, strict: true }], tool_choice: { type: 'tool', name: 'submit_decision', disable_parallel_tool_use: true } };
const headers = (id) => ({ get: k => (k === 'request-id' ? id : null) });
const sleep = (ms, signal) => new Promise((resolve, reject) => { const t = setTimeout(resolve, ms); signal?.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })); }); });
const message = { id: 'msg_buffered123', model: 'claude-sonnet-4-6', stop_reason: 'tool_use', usage: { input_tokens: 3000, output_tokens: 410 }, content: [{ type: 'tool_use', name: 'submit_decision', input: { selected: 'A' } }] };
const sse = (events) => { const enc = new TextEncoder(); const chunks = events.map(e => enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)); let i = 0;
  return { getReader: () => ({ read: async () => (i < chunks.length ? { value: chunks[i++], done: false } : { value: undefined, done: true }) }) }; };

let passed = 0; const test = async (n, f) => { await f(); passed++; console.log('  ok - ' + n); };
(async () => {
  await test('buffered success: separate headers and body times, safe request ID, status and usage', async () => {
    let sent;
    const { body, phases } = await callProvider({ apiKey: KEY, requestBody, deadlineMs: 1000, clock: () => performance.now(), fetchImpl: async (_u, o) => { sent = JSON.parse(o.body); await sleep(30); return { ok: true, status: 200, headers: headers('req_011CabcDEF'), json: async () => { await sleep(20); return message; } }; } });
    assert.equal(body.id, 'msg_buffered123');
    assert.equal(phases.phase, 'complete'); assert.equal(phases.httpStatus, 200); assert.equal(phases.requestId, 'req_011CabcDEF');
    assert.ok(phases.headersMs >= 25 && phases.bodyMs >= 15 && phases.completeMs >= phases.headersMs + phases.bodyMs - 2, JSON.stringify(phases));
    assert.deepEqual(phases.usage, message.usage);
    assert.equal(sent.stream, undefined, 'default request is not changed to streaming');
    assert.deepEqual(sent, requestBody, 'request body sent unchanged');
  });
  await test('timeout before headers is identified as awaiting_headers (no ID exists yet)', async () => {
    await assert.rejects(callProvider({ apiKey: KEY, requestBody, deadlineMs: 60, clock: () => performance.now(), fetchImpl: (_u, o) => sleep(5000, o.signal) }), e => {
      assert.equal(e.name, 'TimeoutError'); assert.equal(e.providerPhases.phase, 'awaiting_headers');
      assert.equal(e.providerPhases.headersMs, null); assert.equal(e.providerPhases.requestId, null);
      assert.ok(e.providerPhases.abortedAtMs >= 55); return true; });
  });
  await test('timeout while reading the body is identified as reading_body, with status and request ID kept', async () => {
    await assert.rejects(callProvider({ apiKey: KEY, requestBody, deadlineMs: 80, clock: () => performance.now(), fetchImpl: async (_u, o) => ({ ok: true, status: 200, headers: headers('req_body_slow1'), json: () => sleep(5000, o.signal) }) }), e => {
      assert.equal(e.providerPhases.phase, 'reading_body'); assert.equal(e.providerPhases.httpStatus, 200);
      assert.equal(e.providerPhases.requestId, 'req_body_slow1'); assert.ok(e.providerPhases.headersMs !== null); return true; });
  });
  await test('HTTP error keeps status and request ID; the API key is redacted', async () => {
    await assert.rejects(callProvider({ apiKey: KEY, requestBody, deadlineMs: 1000, clock: () => performance.now(), fetchImpl: async () => ({ ok: false, status: 529, headers: headers('req_overloaded1'), json: async () => ({ error: { type: 'overloaded_error', message: `busy for ${KEY}` } }) }) }), e => {
      assert.equal(e.message, 'provider_http_529'); assert.equal(e.providerPhases.httpStatus, 529); assert.equal(e.providerPhases.requestId, 'req_overloaded1');
      assert.doesNotMatch(e.providerErrorMessage, /SECRET/); return true; });
  });
  const streamEvents = [
    { type: 'message_start', message: { id: 'msg_stream456', model: 'claude-sonnet-4-6', usage: { input_tokens: 3000, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', name: 'submit_decision', input: {} } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"selec' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: 'ted":"B"}' } },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 412 } },
    { type: 'message_stop' }];
  await test('streaming (diagnostic) separates message start, first output and completion; assembles the same message shape', async () => {
    let sent; const t = [0, 100, 4100, 4600, 13900, 14000]; let i = 0; const clock = () => t[Math.min(i++, t.length - 1)];
    const { body, phases } = await callProvider({ apiKey: KEY, requestBody, deadlineMs: 1000, clock, transport: 'stream', fetchImpl: async (_u, o) => { sent = JSON.parse(o.body); return { ok: true, status: 200, headers: headers('req_stream789'), body: sse(streamEvents) }; } });
    assert.equal(sent.stream, true); assert.deepEqual({ ...sent, stream: undefined }, { ...requestBody, stream: undefined }, 'only stream:true added; strict schema unchanged');
    assert.deepEqual(body.content, [{ type: 'tool_use', name: 'submit_decision', input: { selected: 'B' } }]);
    assert.equal(body.stop_reason, 'tool_use'); assert.equal(body.id, 'msg_stream456');
    assert.equal(phases.requestId, 'req_stream789'); assert.equal(phases.usage.output_tokens, 412);
    assert.ok(phases.headersMs <= phases.messageStartMs && phases.messageStartMs <= phases.firstOutputMs && phases.firstOutputMs <= phases.completeMs, JSON.stringify(phases));
  });
  await test('streaming abort during generation is identified as generating, with the request ID from message_start', async () => {
    const enc = new TextEncoder(); let sent = 0;
    await assert.rejects(callProvider({ apiKey: KEY, requestBody, deadlineMs: 80, clock: () => performance.now(), transport: 'stream', fetchImpl: async (_u, o) => ({ ok: true, status: 200, headers: headers(null),
      body: { getReader: () => ({ read: () => (sent++ === 0 ? Promise.resolve({ value: enc.encode(`data: ${JSON.stringify(streamEvents[0])}\n\n`), done: false }) : sleep(5000, o.signal)) }) } }) }), e => {
      assert.equal(e.providerPhases.usage.input_tokens, 3000); assert.equal(e.providerPhases.phase, 'generating'); assert.equal(e.providerPhases.requestId, 'msg_stream456'); assert.ok(e.providerPhases.messageStartMs !== null); return true; });
  });
  await test('outgoing fingerprint is sizes and hashes only: no evidence content, no credentials', async () => {
    const f = requestFingerprint(requestBody);
    assert.equal(f.strict, true); assert.equal(f.maxTokens, 750); assert.equal(f.model, 'claude-sonnet-4-6');
    assert.ok(f.systemBytes > 0 && f.schemaBytes > 0 && f.evidenceBytes > 0 && /^[a-f0-9]{64}$/.test(f.schemaHash) && /^[a-f0-9]{64}$/.test(f.evidenceHash));
    assert.doesNotMatch(JSON.stringify(f), /Private League Player|SYSTEM PROMPT|SECRET/);
  });
  await test('a malformed request-id header is not recorded', async () => {
    const { phases } = await callProvider({ apiKey: KEY, requestBody, deadlineMs: 1000, clock: () => performance.now(), fetchImpl: async () => ({ ok: true, status: 200, headers: headers('bad id <script>'), json: async () => ({ ...message, id: 'msg_fallback1' }) }) });
    assert.equal(phases.requestId, 'msg_fallback1');
  });
  await test('malformed message ID fallback is not recorded', async () => {
    const { phases } = await callProvider({ apiKey: KEY, requestBody, deadlineMs: 1000, clock: () => performance.now(), fetchImpl: async () => ({ ok: true, status: 200, headers: headers(null), json: async () => ({ ...message, id: 'bad id <script>' }) }) });
    assert.equal(phases.requestId, null);
  });
  console.log('rookie-provider-phase-timing.test.js: ' + passed + ' passed');
})().catch(e => { console.error(e); process.exit(1); });

// End to end: the persisted review records where the wait ended, safely.
(async () => {
  const { hash } = require('../netlify/functions/_super-sage-shadow-llm');
  const { runFastReview } = require('../netlify/functions/_super-sage-shadow-fast-review');
  const packet = { request: {}, players: ['Chris Godwin Jr.', 'Jakobi Meyers'].map(name => ({ name, position: 'WR', facts: [{ field: 'availability', value: { status: 'ACTIVE' } }] })) };
  const decisionId = hash('phase-e2e'), ownerHash = hash('owner');
  const data = new Map([[`evidence/${decisionId}/${ownerHash}`, { ownerHash, frozenEvidence: { packet, evidenceHash: hash(JSON.stringify(packet)) } }]]);
  const store = { get: async k => data.get(k), setJSON: async (k, v, o = {}) => { if (o.onlyIfNew && data.has(k)) return { modified: false }; data.set(k, v); return { modified: true }; } };
  const result = await runFastReview({ store, decisionId, ownerHash, apiKey: 'sk-ant-SECRET', now: new Date('2026-10-11T00:00:00Z'),
    fetchImpl: async () => { throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); } });
  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.providerPhases.phase, 'awaiting_headers');
  assert.equal(result.providerPhases.requestId, null);
  assert.ok(result.outgoing && result.outgoing.requestBytes > 0);
  const saved = JSON.stringify([...data.values()].find(v => v && v.type === 'SUPER_SAGE_FAST_PAIR_REVIEW'));
  assert.match(saved, /"providerPhases"/);
  assert.doesNotMatch(saved, /SECRET/);
  assert.doesNotMatch(JSON.stringify(result.outgoing), /Godwin|Meyers/, 'fingerprint carries no evidence content');
  console.log('  ok - end to end: persisted review records the abort phase and a content-free request fingerprint');
})().catch(e => { console.error(e); process.exit(1); });
