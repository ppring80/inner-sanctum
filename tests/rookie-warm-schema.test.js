'use strict';
const assert = require('node:assert/strict');
const llm = require('../netlify/functions/_super-sage-shadow-llm');
const { POST236, POST238, POST238_WARM, VERSION, ROLE_SYSTEM } = require('../netlify/functions/_super-sage-shadow-fast-review');
const realHash = llm.hash;
// Recorded warm-retry allowance is unchanged and stays bound to its Oct 9
// prompt; the revised role prompt must not be able to spend it.
assert.equal(POST238_WARM.promptHash, '89ee7bb70b68f7c080c4116e762a7260c74496f4f074093386fe470d6ace3baa');
assert.equal(POST238_WARM.priorCapturedAt, '2026-10-10T04:01:04.446Z');
assert.notEqual(realHash(ROLE_SYSTEM), POST238.promptHash);
assert.equal(VERSION, 'rookie-fast-pair-v6-haiku');
const packet = { request: {}, players: ['Blake Corum', 'Will Shipley'].map(name => ({ name, position: 'RB', facts: [{ field: 'availability', value: { status: 'UNKNOWN' } }] })) };
llm.hash = value => value === JSON.stringify(packet) ? POST238.parentEvidenceHash : realHash(value);
delete require.cache[require.resolve('../netlify/functions/_super-sage-shadow-fast-review')];
const { runFastReview } = require('../netlify/functions/_super-sage-shadow-fast-review');
const ownerHash = realHash('owned'), decisionId = POST238.decisionId;
const evidence = { ownerHash, frozenEvidence: { packet, evidenceHash: POST238.parentEvidenceHash } };
const priorKey = `llm-drill/${VERSION}/${POST236.caseId}/${decisionId}/${ownerHash}`;
const prior = { status: 'INVALID', requestId: POST238.requestId, parentEvidenceHash: POST238.parentEvidenceHash, rawText: 'immutable original answer' };
const data = new Map([[`evidence/${decisionId}/${ownerHash}`, evidence], [priorKey, prior], ['llm-fast-budget/2026-10-10', { spent: true }]]);
const firstKey = `llm-drill/${VERSION}/${POST238.caseId}/${decisionId}/${ownerHash}`;
const firstAttempt = { status: 'UNAVAILABLE', error: 'twenty_second_quality_timeout', capturedAt: POST238_WARM.priorCapturedAt, promptHash: POST238_WARM.promptHash, parentEvidenceHash: POST238_WARM.parentEvidenceHash };
data.set(firstKey, firstAttempt);
data.set(`llm-drill-budget/${VERSION}/${POST238.caseId}`, { spent: true });
const before = JSON.stringify([...data]);
let calls = 0;
const store = { get: async key => data.get(key), setJSON: async (key, value, options = {}) => {
 if (options.onlyIfNew && data.has(key)) return { modified: false };
 data.set(key, value); return { modified: true };
} };
const args = { store, decisionId, ownerHash, caseId: 'role-change', apiKey: 'mock', now: new Date('2026-10-10T03:00:00Z'), fetchImpl: async (_url, options) => {
 calls++;
 const request = JSON.parse(options.body);
 assert.equal(realHash(request.system), POST238.promptHash);
 assert.equal(POST238_WARM.promptHash, POST238.promptHash); assert.equal(request.max_tokens, 750); assert.equal(request.model, 'claude-sonnet-4-6');
 assert.ok(!options.body.includes(POST238.requestId));
 return { ok: true, json: async () => ({ id: 'fresh-qualification', stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'submit_decision', input: { selected: 'A', confidence: 'LOW', explanationSentences: [
  { text: 'I lean toward A.', factIds: ['A:availability'] },
  { text: 'Both reported statuses are unknown.', factIds: ['A:availability', 'B:availability'] }
 ], statusSentence: { text: 'The reported status is unknown.', factIds: ['A:availability'] }, caveat: 'Reported status unknown.', reconsider: 'A new status report.' } }] }) };
} };
(async () => {
 const refused = await runFastReview(args);
 assert.equal(refused.error, 'authorized_qualification_bound', JSON.stringify(refused).slice(0, 200));
 assert.equal(calls, 0, 'no paid call: the warm allowance is bound to the recorded prompt');
 assert.equal(JSON.stringify([...data]), before, 'evidence, prior review, first attempt and budgets unchanged');
 console.log('Warm-schema allowance history preserved: bound to its recorded prompt; refuses the revised prompt with no call and no state change. Provider mocked.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { llm.hash = realHash; });
