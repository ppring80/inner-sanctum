'use strict';
const crypto = require('crypto');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
// This module has no provider function, fetch, queue, budget or write path.
async function readSavedReview({ store, decisionId, ownerHash, kind = 'post232-role-change' }) {
  if (!/^[a-f0-9]{64}$/.test(decisionId || '') || !/^[a-f0-9]{64}$/.test(ownerHash || '')) {
    return { available: false, readOnly: true, error: 'invalid_request' };
  }
  const keys = {
    'post232-role-change': `llm-drill/rookie-fast-pair-v6-haiku/fresh-role-post232/${decisionId}/${ownerHash}`,
    'focused-role-change': `llm-fast/rookie-fast-pair-v6-haiku/${decisionId}/${ownerHash}/fresh-role-change`,
    'stream-diagnostic': `llm-drill/rookie-fast-pair-v6-haiku/role-stream-diagnostic-post244/${decisionId}/${ownerHash}`,
    full: `llm/rookie-independent-v2/${decisionId}/${ownerHash}`
  };
  if (!Object.hasOwn(keys, kind)) return { available: false, readOnly: true, error: 'invalid_review_kind' };
  const [evidence, priorReview, qualification] = await Promise.all([
    store.get(`evidence/${decisionId}/${ownerHash}`, { type: 'json' }),
    store.get(keys[kind], { type: 'json' }),
    kind === 'stream-diagnostic' ? store.get(`llm-drill/rookie-fast-pair-v6-haiku/role-qualification-post246/${decisionId}/${ownerHash}`, { type: 'json' }) : null
  ]);
  if (!evidence || evidence.ownerHash !== ownerHash || !evidence.frozenEvidence) {
    return { available: false, readOnly: true, error: 'owned_frozen_evidence_unavailable' };
  }
  if (hash(JSON.stringify(evidence.frozenEvidence.packet)) !== evidence.frozenEvidence.evidenceHash) {
    return { available: false, readOnly: true, error: 'evidence_integrity_failure' };
  }
  const review = qualification || priorReview;
  return { available: Boolean(review), readOnly: true, decisionId, kind, review: review || null };
}
module.exports = { readSavedReview };
