'use strict';
const assert = require('assert');
const { validatePairVoice } = require('../netlify/functions/_super-sage-shadow-voice');
const { validate } = require('../netlify/functions/_super-sage-shadow-fast-review');
const { revalidateCached } = require('../netlify/functions/_super-sage-rookie-claim-checks');
const packet = { requireSentenceEvidence: true, players: [
  { id: 'A', name: 'Receiver A', position: 'WR', facts: [{ factId: 'A:projection', field: 'projection', value: { points: 10 } }] },
  { id: 'B', name: 'Receiver B', position: 'WR', facts: [{ factId: 'B:projection', field: 'projection', value: { points: 9 } }] }
] };
const answer = { selected: 'A', confidence: 'LOW', explanation: "I'd start Receiver A because he has a slight edge in projected points.\nReceiver B is close enough that this is a cautious lean.\nCheck for new information before kickoff because these are forecasts, not guarantees.", caveat: 'The projected difference is small.', reconsider: 'A new projection favoring Receiver B could change my choice.', factIds: ['A:projection', 'B:projection'], sentenceFactIds: [['A:projection', 'B:projection'], ['A:projection', 'B:projection'], ['A:projection', 'B:projection']] };
assert.deepStrictEqual(validate(answer, packet), []);
const phrases = ['effect is unvalidated', 'verified role-change flag', 'redistribution is unverified', 'moderate-volume role', 'Strong Positive matchup', 'essential fields are absent', 'concrete blocker'];
for (const field of ['explanation', 'caveat', 'reconsider']) for (const phrase of phrases) {
  const report = { ...answer, [field]: phrase };
  assert.ok(validatePairVoice(report).includes('report_like_customer_language'));
  const errors = validate(report, packet);
  assert.ok(errors.includes('report_like_customer_language'));
  const stored = { status: 'REVIEW_READY', answer: report };
  assert.strictEqual(revalidateCached(stored, errors).status, 'INVALID');
  assert.strictEqual(stored.status, 'REVIEW_READY');
  assert.strictEqual(stored.answer[field], phrase);
}
assert.deepStrictEqual(validatePairVoice({ explanation: "I can't choose confidently because I don't have current injury status or projections for either player. Check those before setting your lineup." }), []);
assert.deepStrictEqual(validate(answer, { ...packet, requireSentenceEvidence: false }), []);
console.log('Private Rookie voice: observed report language rejected in all customer text fields, natural wording accepted, saved answers preserved. Not complete semantic or style verification.');
