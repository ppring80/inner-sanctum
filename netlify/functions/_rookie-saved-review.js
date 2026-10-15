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
  const [evidence, priorReview, qualification, latestQualification, finalQualification] = await Promise.all([
    store.get(`evidence/${decisionId}/${ownerHash}`, { type: 'json' }),
    store.get(keys[kind], { type: 'json' }),
    kind === 'stream-diagnostic' ? store.get(`llm-drill/rookie-fast-pair-v6-haiku/role-qualification-post246/${decisionId}/${ownerHash}`, { type: 'json' }) : null,
    kind === 'stream-diagnostic' ? store.get(`llm-drill/rookie-fast-pair-v6-haiku/role-qualification-post248/${decisionId}/${ownerHash}`, { type: 'json' }) : null,
    kind === 'stream-diagnostic' ? store.get(`llm-drill/rookie-fast-pair-v6-haiku/role-final-voice-qualification/${decisionId}/${ownerHash}`, { type: 'json' }) : null
  ]);
  if (!evidence || evidence.ownerHash !== ownerHash || !evidence.frozenEvidence) {
    return { available: false, readOnly: true, error: 'owned_frozen_evidence_unavailable' };
  }
  if (hash(JSON.stringify(evidence.frozenEvidence.packet)) !== evidence.frozenEvidence.evidenceHash) {
    return { available: false, readOnly: true, error: 'evidence_integrity_failure' };
  }
  const review = finalQualification || latestQualification || qualification || priorReview;
  // Explicit full-review reads may inspect the original input after the same
  // ownership/integrity gate. No owner key, credentials, recomputation or write.
  const input = kind==='full' ? {frozenEvidence:evidence.frozenEvidence} : {};
  if(kind==='full') {
    const fullQualification=await store.get(require('./_rookie-full-post276').reviewKey(decisionId,ownerHash),{type:'json'});
    const candidate=await store.get(`llm-qualification/lineup-candidate-qualification-v1/${decisionId}/${ownerHash}`,{type:'json'});
    if(candidate)return {available:true,readOnly:true,decisionId,kind,review:candidate,priorQualification:fullQualification||null,priorReview:priorReview||null,...input};
    if(fullQualification)return {available:true,readOnly:true,decisionId,kind,review:fullQualification,priorReview:priorReview||null,...input};
  }
  return { available: Boolean(review), readOnly: true, decisionId, kind, review: review || null,...input };
}
module.exports = { readSavedReview };
