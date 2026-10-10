'use strict';
const assert = require('assert');
const crypto = require('crypto');
const { readSavedReview } = require('../netlify/functions/_rookie-saved-review');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const decisionId = 'a'.repeat(64), ownerHash = hash('linked-owner');
const packet = { players: [{ name: 'Will Shipley' }] };
const evidence = { ownerHash, frozenEvidence: { packet, evidenceHash: hash(JSON.stringify(packet)) } };
const review = { decisionId, status: 'INVALID', requestId: 'saved-provider-id', rawText: 'exact saved answer', validationErrors: ['saved-finding'], providerMs: 10563 };
let reads = [], writes = 0;
const records = new Map();
const evidenceKey = `evidence/${decisionId}/${ownerHash}`;
const reviewKey = `llm-drill/rookie-fast-pair-v6-haiku/fresh-role-post232/${decisionId}/${ownerHash}`;
const store = { get: async key => { reads.push(key); return records.get(key) || null; }, setJSON: () => { writes++; throw Error('must never write'); } };
(async () => {
 records.set(evidenceKey, evidence); records.set(reviewKey, review);
 const before = JSON.stringify(review);
 const result = await readSavedReview({ store, decisionId, ownerHash });
 assert.strictEqual(result.available, true); assert.strictEqual(result.readOnly, true);
 assert.deepStrictEqual(result.review, review); assert.strictEqual(JSON.stringify(review), before);
 assert.deepStrictEqual(reads.sort(), [evidenceKey, reviewKey].sort());
 reads = [];
 assert.strictEqual((await readSavedReview({ store, decisionId, ownerHash: 'b'.repeat(64) })).error, 'owned_frozen_evidence_unavailable');
 assert.ok(reads.every(key => !key.includes(ownerHash)));
 records.set(evidenceKey, { ...evidence, ownerHash: 'b'.repeat(64) });
 assert.strictEqual((await readSavedReview({ store, decisionId, ownerHash })).available, false);
 records.set(evidenceKey, { ...evidence, frozenEvidence: { ...evidence.frozenEvidence, packet: { changed: true } } });
 assert.strictEqual((await readSavedReview({ store, decisionId, ownerHash })).error, 'evidence_integrity_failure');
 records.set(evidenceKey, evidence); records.delete(reviewKey);
 assert.strictEqual((await readSavedReview({ store, decisionId, ownerHash })).review, null);
 for (const kind of ['focused-role-change', 'full']) {
  assert.strictEqual((await readSavedReview({ store, decisionId, ownerHash, kind })).available, false);
 }
 reads = [];
 assert.strictEqual((await readSavedReview({ store, decisionId: 'invalid', ownerHash })).error, 'invalid_request');
 assert.strictEqual((await readSavedReview({ store, decisionId, ownerHash, kind: '__proto__' })).error, 'invalid_review_kind');
 assert.strictEqual(reads.length, 0); assert.strictEqual(writes, 0);
 console.log('Saved Rookie reader: exact immutable review, ownership, integrity, unavailable without generation or writes.');
})().catch(error => { console.error(error); process.exitCode = 1; });
