'use strict';
const assert = require('node:assert/strict');
const llm = require('../netlify/functions/_super-sage-shadow-llm');
const { POST236, POST238, VERSION, ROLE_SYSTEM } = require('../netlify/functions/_super-sage-shadow-fast-review');
const realHash = llm.hash;
// Recorded history is unchanged; the current role prompt is a later revision,
// so the Oct 9 allowance must refuse it (no reuse, no new exception).
assert.equal(POST238.promptHash, '89ee7bb70b68f7c080c4116e762a7260c74496f4f074093386fe470d6ace3baa');
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
 assert.equal(request.max_tokens, 750); assert.equal(request.model, 'claude-sonnet-4-6');
 assert.ok(!options.body.includes(POST238.requestId));
 return { ok: true, json: async () => ({ id: 'fresh-qualification', stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'submit_decision', input: { selected: 'A', confidence: 'LOW', explanationSentences: [
  { text: 'I lean toward A.', factIds: ['A:availability'] },
  { text: 'Both reported statuses are unknown.', factIds: ['A:availability', 'B:availability'] }
 ], statusSentence: { text: 'The reported status is unknown.', factIds: ['A:availability'] }, caveat: 'Reported status unknown.', reconsider: 'A new status report.' } }] }) };
} };
(async () => {
 const refused = await runFastReview(args);
 assert.equal(refused.error, 'authorized_qualification_bound', JSON.stringify(refused).slice(0, 200));
 assert.equal(calls, 0, 'no paid call under an allowance bound to an older prompt');
 assert.equal(JSON.stringify([...data].slice(0, 3)), before, 'old evidence, review and daily budget unchanged');
 assert.equal((await runFastReview({ ...args, ownerHash: realHash('someone else') })).error, 'owned_frozen_evidence_unavailable');
 console.log('Post238 qualification history preserved: the Oct 9 allowance is bound to its recorded prompt and refuses the revised prompt (no call, no budget/history change). Provider mocked.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { llm.hash = realHash; });
