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
const phrases = ['effect is unvalidated', 'verified role-change flag', 'redistribution is unverified', 'both are sourced as unavailable', 'moderate-volume role', 'Strong Positive matchup', 'essential fields are absent', 'concrete blocker', 'higher observed baseline', 'workload split', 'backfield role order'];
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

// The actual mixed-position review exposed gaps shared by all focused pairs.
const mixedReview = { explanation: "I'd start Kendre Miller because his recent involvement has been climbing — 7, 9, then 10 opportunities last game — giving him a higher observed baseline than Meyers' recent 8, 4, 3 trend, plus a better matchup.", caveat: "Miller's backfield role order is unconfirmed with teammates present.", reconsider: 'If Kamara or Donaldson is confirmed as the lead back before kickoff.' };
assert.deepStrictEqual(validatePairVoice(mixedReview), ['unexplained_opportunity_metric', 'report_like_customer_language']);
for (const field of ['explanation', 'caveat', 'reconsider']) {
  assert.ok(validatePairVoice({ [field]: 'He had 10 opportunities last game.' }).includes('unexplained_opportunity_metric'));
}
for (const explanation of [
  "I'd lean Miller: he has had more carries and targets recently, though Meyers projects slightly higher.",
  "Miller averaged 8.7 opportunities — carries plus targets — across his last three games.",
  "Miller averaged 8.7 opportunities (carries + targets) across his last three games."
]) assert.deepStrictEqual(validatePairVoice({ explanation }), []);
assert.ok(validate({ ...answer, caveat: 'He had 10 opportunities last game.' }, packet).includes('unexplained_opportunity_metric'));
const oldReview = { status: 'REVIEW_READY', answer: mixedReview };
assert.strictEqual(revalidateCached(oldReview, validatePairVoice(mixedReview)).status, 'INVALID');
assert.strictEqual(oldReview.status, 'REVIEW_READY');
const { HUMAN_PAIR_STYLE } = require('../netlify/functions/_super-sage-shadow-voice');
assert.ok(HUMAN_PAIR_STYLE.includes('carries plus targets'));
assert.ok(!HUMAN_PAIR_STYLE.includes('higher observed baseline'));
assert.ok(!HUMAN_PAIR_STYLE.includes('backfield role order'));
assert.ok(HUMAN_PAIR_STYLE.includes('cite both players'));
