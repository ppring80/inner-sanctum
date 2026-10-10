'use strict';
const assert = require('node:assert/strict');
const llm = require('../netlify/functions/_super-sage-shadow-llm');
const { POST232, POST236, VERSION, ROLE_SYSTEM } = require('../netlify/functions/_super-sage-shadow-fast-review');
const realHash = llm.hash;
assert.equal(realHash(ROLE_SYSTEM), POST236.promptHash);
assert.equal(VERSION, 'rookie-fast-pair-v6-haiku');
const packet = { request: {}, players: ['Blake Corum', 'Will Shipley'].map(name => ({ name, position: 'RB', facts: [{ field: 'availability', value: { status: 'UNKNOWN' } }] })) };
llm.hash = value => value === JSON.stringify(packet) ? POST236.parentEvidenceHash : realHash(value);
delete require.cache[require.resolve('../netlify/functions/_super-sage-shadow-fast-review')];
const { runFastReview } = require('../netlify/functions/_super-sage-shadow-fast-review');
const ownerHash = realHash('owned'), decisionId = POST236.decisionId;
const evidence = { ownerHash, frozenEvidence: { packet, evidenceHash: POST236.parentEvidenceHash } };
const priorKey = `llm-drill/${VERSION}/${POST232.caseId}/${decisionId}/${ownerHash}`;
const prior = { status: 'INVALID', requestId: POST236.requestId, parentEvidenceHash: POST236.parentEvidenceHash, rawText: 'immutable original answer' };
const data = new Map([[`evidence/${decisionId}/${ownerHash}`, evidence], [priorKey, prior], ['llm-fast-budget/2026-10-10', { spent: true }]]);
const before = JSON.stringify([...data]);
let calls = 0;
const store = { get: async key => data.get(key), setJSON: async (key, value, options = {}) => {
 if (options.onlyIfNew && data.has(key)) return { modified: false };
 data.set(key, value); return { modified: true };
} };
const args = { store, decisionId, ownerHash, caseId: 'role-change', apiKey: 'mock', now: new Date('2026-10-10T03:00:00Z'), fetchImpl: async (_url, options) => {
 calls++;
 const request = JSON.parse(options.body);
 assert.equal(realHash(request.system), POST236.promptHash);
 assert.equal(request.max_tokens, 750); assert.equal(request.model, 'claude-sonnet-4-6');
 assert.ok(!options.body.includes(POST236.requestId));
 return { ok: true, json: async () => ({ id: 'fresh-qualification', stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'submit_decision', input: { selected: 'A', confidence: 'LOW', explanationSentences: [
  { text: 'I lean toward A.', factIds: ['A:availability'] },
  { text: 'Both reported statuses are unknown.', factIds: ['A:availability', 'B:availability'] }
 ], caveat: 'Reported status unknown.', reconsider: 'A new status report.' } }] }) };
} };
(async () => {
 await Promise.all([runFastReview(args), runFastReview(args)]);
 assert.equal(calls, 1, 'only one atomic paid generation');
 const cached = await runFastReview(args);
 assert.equal(cached.cached, true); assert.equal(cached.requestId, 'fresh-qualification');
 assert.equal(cached.experiment, POST236.caseId); assert.equal(calls, 1);
 assert.equal(JSON.stringify([...data].slice(0, 3)), before, 'old evidence, review and daily budget unchanged');
 assert.equal((await runFastReview({ ...args, ownerHash: realHash('someone else') })).error, 'owned_frozen_evidence_unavailable');
 const budgetKey = `llm-drill-budget/${VERSION}/${POST236.caseId}`;
 assert.ok(data.has(budgetKey));
 data.delete(`llm-drill/${VERSION}/${POST236.caseId}/${decisionId}/${ownerHash}`);
 const blocked = await runFastReview(args);
 assert.equal(blocked.error, 'daily_speed_benchmark_limit'); assert.equal(calls, 1, 'spent allowance cannot retry');
 console.log('Post236 qualification: exact owner/evidence/prior/prompt, one atomic call, bounded request/output, no retry or old budget/history reset. Provider mocked.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { llm.hash = realHash; });
