'use strict';
// Rookie structured pair v2: server-rendered opposing advantages, per-packet
// deciding-factor binding, explicit v1 compatibility. Provider mocked; no paid call.
// Generic fixtures exercise both tied and missing availability. The additional
// historical-facts case uses values verified against the hash-matched production
// packet; private source provenance is not copied into this public test.
const assert = require('node:assert/strict');
const sp = require('../netlify/functions/_rookie-structured-pair');
const { plainPresentation } = require('../netlify/functions/_rookie-plain-presentation');
const clone = x => JSON.parse(JSON.stringify(x));
const player = (id, name, position, points, matchup, level, avail, avg = 7.67) => ({ id, name, position, facts: [
  ['projection', { admissible: true, points }], ['observedOpportunity', { avgLast3: avg }], ['matchup', matchup], ['establishedRole', { status: 'ESTABLISHED', level }], ['availability', avail]
].map(([field, value]) => ({ field, value, factId: `${id}:${field}` })) });
const ACTIVE = { effectiveStatus: { status: 'ACTIVE' }, unavailable: false, questionable: false };
const UNVERIFIED = { effectiveStatus: { status: 'UNVERIFIED' }, unavailable: false, questionable: false };
const QUESTIONABLE = { effectiveStatus: { status: 'QUESTIONABLE', reported: 'Q' }, unavailable: false, questionable: true };
const present = players => plainPresentation({ packet: { players, requiredDisclosures: [] } }).packet;
let passed = 0; const test = (n, f) => { f(); passed++; console.log('  ok - ' + n); };

// LABELED FIXTURE: Bernard (WR) vs Higbee (TE) failure shape — Bernard projects higher,
// availability tied (both active) or not comparable (Bernard unverified).
const bhTied = present([player('A', 'Germie Bernard', 'WR', 9.1, 'Neutral', 'moderate-volume', ACTIVE, 6), player('B', 'Tyler Higbee', 'TE', 5.4, 'Strong Positive', 'high-volume', ACTIVE, 7.67)]);
const bhMissing = present([player('A', 'Germie Bernard', 'WR', 9.1, 'Neutral', 'moderate-volume', UNVERIFIED, 6), player('B', 'Tyler Higbee', 'TE', 5.4, 'Strong Positive', 'high-volume', ACTIVE, 7.67)]);
const failedV1 = { selected: 'A', confidence: 'HIGH', decidingFactor: 'projection', tradeoffFactor: 'availability', blocker: 'NONE', reconsider: 'pick_ruled_out' };
const v2Pick = { selected: 'A', confidence: 'HIGH', decidingFactor: 'projection', blocker: 'NONE', reconsider: 'pick_ruled_out' };

test('Bernard–Higbee shape: tied or missing availability is never a selectable deciding factor', () => {
  assert.deepEqual(bhTied.advantages, { A: ['projection'], B: ['recentUsage', 'matchup'], tied: ['availability'], notComparable: [] });
  assert.deepEqual(bhMissing.advantages.notComparable, ['availability']);
  for (const p of [bhTied, bhMissing]) assert.ok(!sp.schemaFor(p).properties.decidingFactor.enum.includes('availability'));
  assert.equal(sp.schemaFor(bhTied).properties.tradeoffFactor, undefined, 'the model no longer selects a tradeoff');
});
test('Bernard–Higbee shape: the failed v1 answer stays failed; the v2 answer renders every Higbee advantage from the server', () => {
  assert.ok(sp.validate(failedV1, bhTied).includes('tradeoff_factor_not_for_alternative'), 'failed v1 is judged by v1 rules, not reinterpreted');
  assert.deepEqual(sp.validate(v2Pick, bhTied), []);
  const r = sp.render(v2Pick, bhTied);
  assert.equal(r.answerContract, 'structured-pair-v2');
  assert.deepEqual(r.opposingFactors, ['recentUsage', 'matchup']);
  assert.match(r.caveat, /^The tradeoffs: Tyler Higbee had more recent carries plus targets \(7\.67 versus 6 per game\).*; Tyler Higbee has the more favorable matchup\.$/);
  assert.ok(r.factIds.includes('B:matchup') && r.factIds.includes('B:observedOpportunity'));
});
test('verified historical Bernard–Higbee comparison: both availability and matchup tied, no opposing advantage', () => {
  // Historical v1 pair hash was verified separately from the owned frozen parent:
  // c65b110ed4f43b3d311d9e9dd972634ff801012988490fea66e8d02caa223a3a.
  // This fixture reproduces its comparison facts, not the entire private packet.
  const p=present([player('A','Germie Bernard','WR',10.3,'Positive','high-volume',ACTIVE,8),player('B','Tyler Higbee','TE',7.52,'Positive','moderate-volume',ACTIVE,5.33)]);
  assert.deepEqual(p.advantages,{A:['projection','recentUsage'],B:[],tied:['matchup','availability'],notComparable:[]});
  assert.deepEqual(sp.validateV1(failedV1,p),['tradeoff_factor_not_for_alternative']);
  assert.deepEqual(sp.schemaFor(p).properties.decidingFactor.enum,['projection','recentUsage','NONE']);
  assert.deepEqual(sp.validateV2(v2Pick,p),[]);
  assert.equal(sp.renderV2(v2Pick,p).caveat,'No supplied comparison factor favors the alternative.');
});
test('no opposing advantage: the server says so; it cannot be misreported', () => {
  const p = present([player('A', 'Pick', 'WR', 10, 'Positive', 'high-volume', ACTIVE, 9), player('B', 'Other', 'WR', 6, 'Negative', 'moderate-volume', ACTIVE, 5)]);
  assert.deepEqual(p.advantages.B, []);
  assert.equal(sp.render(v2Pick, p).caveat, 'No supplied comparison factor favors the alternative.');
});
test('one opposing advantage renders as the single tradeoff', () => {
  const p = present([player('A', 'Pick', 'WR', 10, 'Neutral', 'high-volume', ACTIVE, 9), player('B', 'Other', 'WR', 6, 'Positive', 'moderate-volume', ACTIVE, 5)]);
  assert.match(sp.render(v2Pick, p).caveat, /^The tradeoff: Other has the more favorable matchup\.$/);
});
test('wrong-direction deciding factor is rejected (validation unchanged)', () => {
  assert.ok(sp.validate({ ...v2Pick, decidingFactor: 'matchup' }, bhTied).includes('deciding_factor_not_for_pick'));
  assert.ok(sp.validate({ ...v2Pick, decidingFactor: 'availability' }, bhTied).some(e => /invalid_decidingFactor|deciding_factor_not_for_pick/.test(e)));
});
test('unavailable pick, conditional reversal and availability-as-advantage', () => {
  const out = clone(bhTied); out.players[0].facts.find(f => f.field === 'availability').value.unavailable = true;
  assert.ok(sp.validate(v2Pick, out).includes('unavailable_player_selected'));
  assert.ok(sp.validate({ ...v2Pick, reconsider: 'alternative_cleared' }, bhTied).includes('reconsider_not_reversal'));
  const q = present([player('A', 'Pick', 'WR', 10, 'Neutral', 'high-volume', ACTIVE, 9), player('B', 'Other', 'TE', 6, 'Neutral', 'moderate-volume', QUESTIONABLE, 5)]);
  assert.deepEqual(q.advantages.A, ['projection', 'recentUsage', 'availability']);
  assert.deepEqual(sp.validate({ ...v2Pick, reconsider: 'alternative_cleared' }, q), []);
  assert.deepEqual(sp.validate({ ...v2Pick, decidingFactor: 'availability' }, q), []);
});
test('cross-position pairs keep roles as context; NO_CALL rules unchanged', () => {
  const r = sp.render(v2Pick, bhTied);
  assert.match(r.explanation, /Germie Bernard: steady recent role for his position\.|Germie Bernard: .*role/);
  const nc = { selected: null, confidence: 'LOW', decidingFactor: 'NONE', blocker: 'conflicting_evidence', reconsider: 'evidence_resolves_blocker' };
  assert.deepEqual(sp.validate(nc, bhTied), []);
  assert.ok(sp.validate({ ...nc, blocker: 'NONE' }, bhTied).includes('no_call_without_supported_blocker'));
  assert.ok(sp.validate({ ...nc, decidingFactor: 'projection' }, bhTied).includes('invalid_no_call_shape'));
  const allTied = present([player('A', 'X', 'WR', 7, 'Neutral', 'moderate-volume', ACTIVE, 6), player('B', 'Y', 'WR', 7, 'Neutral', 'moderate-volume', ACTIVE, 6)]);
  assert.deepEqual(sp.schemaFor(allTied).properties.decidingFactor.enum, ['NONE']);
  assert.deepEqual(sp.validate({ ...nc, blocker: 'no_supported_factor' }, allTied), []);
  assert.equal(sp.render(sp.decode({ ...nc, selected: 'NO_CALL' }), bhTied).selected, null);
});
test('existing accepted case (Higbee/Allen replay fixture): v1 accepted answers still validate and render as v1; v2 equivalents too', () => {
  const raw = { players: [player('A', 'Tyler Higbee', 'TE', 5.44, 'Strong Positive', 'high-volume', ACTIVE), player('B', 'Keenan Allen', 'WR', 8.57, 'Neutral', 'moderate-volume', ACTIVE)], requiredDisclosures: [] };
  const v1Packet = plainPresentation({ packet: clone(raw) }, { contract: 'v1' }).packet, v2Packet = plainPresentation({ packet: clone(raw) }).packet;
  const acceptedV1 = { selected: 'B', confidence: 'MEDIUM', decidingFactor: 'projection', tradeoffFactor: 'matchup', blocker: 'NONE', reconsider: 'pick_ruled_out' };
  assert.deepEqual(sp.validate(acceptedV1, v1Packet), []);
  assert.equal(sp.render(acceptedV1, v1Packet).answerContract, 'structured-pair-v1');
  const { tradeoffFactor, ...acceptedV2 } = acceptedV1;
  assert.deepEqual(sp.validate(acceptedV2, v2Packet), []);
  assert.match(sp.render(acceptedV2, v2Packet).caveat, /Tyler Higbee has the more favorable matchup/);
});
test('v1 packet, prompt and schema match pinned pre-repair hashes', () => {
  // Captured from a696ab2 before applying this repair. Independent of git refs,
  // checkout depth and the future contents of main.
  const {hash}=require('../netlify/functions/_super-sage-shadow-llm');
  const raw = { players: [player('A', 'Tyler Higbee', 'TE', 5.44, 'Strong Positive', 'high-volume', ACTIVE), player('B', 'Keenan Allen', 'WR', 8.57, 'Neutral', 'moderate-volume', ACTIVE)], requiredDisclosures: [] };
  assert.equal(hash(JSON.stringify(plainPresentation({packet:raw},{contract:'v1'}).packet)), '7df3a2e27d7139aa13a81fea89673f1229dfc0b1337f195d01199f5ed8488df4');
  assert.equal(hash(sp.SYSTEM_V1), '07e6edda7dc6f30e18d41817f7f4c863bfd1e9edad24b8a5ce67c3b369a66cec');
  assert.equal(hash(JSON.stringify(sp.schema_V1)), 'd0033acbef742e7b6b6503f2ba41c83b20bf4e14e564f016c7a2a91e25479e94');
});

// End to end through runFastReview (real Week 4 record; Corum/Sutton accepted pair).
(async () => {
  const { run } = require('../scripts/run-super-sage-week4-acceptance');
  const { hash, buildEvidence } = require('../netlify/functions/_super-sage-shadow-llm');
  const fast = require('../netlify/functions/_super-sage-shadow-fast-review');
  const record = run().record, frozen = buildEvidence(record), decisionId = record.decisionId, ownerHash = hash('owner-v2');
  const idx = record.slots.findIndex(s => s.decisionState === 'PROVISIONAL_UNRESOLVED' && s.starter && s.comparator), slot = record.slots[idx];
  const selection = { players: [slot.starter.name, slot.comparator.name], slotId: frozen.packet.slots[idx].slotId };
  const makeStore = () => { const data = new Map([[`evidence/${decisionId}/${ownerHash}`, { ownerHash, frozenEvidence: frozen }]]);
    return { data, get: async k => data.get(k), setJSON: async (k, v, o = {}) => { if (o.onlyIfNew && data.has(k)) return { modified: false }; data.set(k, v); return { modified: true }; } }; };
  const v1Packet = await fast.prepareSelectedPair(frozen, selection, { contract: 'v1' });
  const v1Key = `llm-fast/${fast.VERSION}/${decisionId}/${ownerHash}/selected/${hash(JSON.stringify(selection))}/request/${hash(JSON.stringify({ evidenceHash: v1Packet.evidenceHash, promptHash: hash(sp.SYSTEM_V1), schemaHash: hash(JSON.stringify(sp.schema_V1)) }))}`;
  const v1Valid = { selected: 'A', confidence: 'MEDIUM', decidingFactor: 'recentUsage', tradeoffFactor: 'projection', blocker: 'NONE', reconsider: 'pick_ruled_out' };
  assert.deepEqual(sp.validateV1(v1Valid, v1Packet.packet), [], 'fixture answer is valid under v1');
  const budgetKeys = s => [...s.data.keys()].filter(k => k.startsWith('llm-fast-budget'));
  const noProvider = async () => { throw Error('provider must not be called'); };
  const now = new Date('2026-10-18T12:00:00Z');

  const s1 = makeStore(); s1.data.set(v1Key, { type: 'SUPER_SAGE_FAST_PAIR_REVIEW', status: 'REVIEW_READY', decisionId, parentEvidenceHash:frozen.evidenceHash, evidenceHash: v1Packet.evidenceHash, answer: v1Valid });
  const legacy = await fast.runFastReview({ store: s1, decisionId, ownerHash, apiKey: 'k', selection, fetchImpl: noProvider, now });
  assert.equal(legacy.status, 'REVIEW_READY'); assert.equal(legacy.legacyContract, 'structured-pair-v1'); assert.equal(legacy.cached, true);
  assert.deepEqual(budgetKeys(s1), [], 'a saved v1 review reserves no budget');
  passed++; console.log('  ok - a valid saved v1 review is returned under v1 rules, with no provider call and no budget use');

  const s2 = makeStore(); s2.data.set(v1Key, { type: 'SUPER_SAGE_FAST_PAIR_REVIEW', status: 'INVALID', decisionId, evidenceHash: v1Packet.evidenceHash, answer: { ...v1Valid, tradeoffFactor: 'recentUsage' }, validationErrors: ['tradeoff_factor_not_for_alternative'] });
  const failed = await fast.runFastReview({ store: s2, decisionId, ownerHash, apiKey: 'k', selection, fetchImpl: noProvider, now });
  assert.notEqual(failed.status, 'REVIEW_READY'); assert.equal(failed.legacyContract, 'structured-pair-v1');
  assert.deepEqual(budgetKeys(s2), []); assert.equal(s2.data.size, 2, 'no rewrite, no deletion, no new review written');
  passed++; console.log('  ok - a failed saved v1 review stays failed: no reinterpretation, no automatic paid rerun, history untouched');

  // Exercise both real consumers, not just the lower-level cache reader.
  const {recordKey,runSecondOpinion}=require('../netlify/functions/_rookie-second-opinion-live');
  const {currentKey,requestPair}=require('../netlify/functions/_rookie-requested-pair');
  const recordHash=hash(JSON.stringify(record));
  s1.data.set(recordKey(decisionId,ownerHash),{ownerHash,record,recordHash});
  s1.data.set(currentKey(ownerHash),{inputSource:'linked_league',decisionId,recordHash});
  const liveArgs={store:s1,decisionId,ownerHash,apiKey:'k',fetchImpl:noProvider,now};
  const savedCustomer=await runSecondOpinion({...liveArgs,savedOnly:true});
  assert.equal(savedCustomer.status,'REVIEW_READY',JSON.stringify(savedCustomer));
  assert.equal(savedCustomer.secondOpinion.answer.answerContract,'structured-pair-v1');
  const requestedCustomer=await requestPair({...liveArgs,players:selection.players,consentToAnthropic:true});
  assert.equal(requestedCustomer.status,'READY',JSON.stringify(requestedCustomer));
  assert.equal(requestedCustomer.timing.cached,true);
  assert.deepEqual(budgetKeys(s1),[]);
  passed++;console.log('  ok - saved and requested customer adapters reuse valid v1 with matched evidence hashes');

  const s4=makeStore();
  s4.data.set(v1Key,{status:'INVALID',decisionId,evidenceHash:v1Packet.evidenceHash,answer:v1Valid,validationErrors:['invalid_sentence_evidence']});
  const historicalFailure=await fast.runFastReview({store:s4,decisionId,ownerHash,apiKey:'k',selection,fetchImpl:noProvider,now});
  assert.equal(historicalFailure.status,'INVALID','no old failure may be promoted by legacy cache handling');
  assert.equal(s4.data.size,2);assert.deepEqual(budgetKeys(s4),[]);
  const readError=makeStore(),read=readError.get;
  readError.get=async key=>{if(key===v1Key)throw Error('storage unavailable');return read(key);};
  const blocked=await fast.runFastReview({store:readError,decisionId,ownerHash,apiKey:'k',selection,fetchImpl:noProvider,now});
  assert.equal(blocked.error,'legacy_review_read_failed');assert.equal(readError.data.size,1);
  passed++;console.log('  ok - legacy failure remains failed and cache read errors cannot trigger paid calls');

  const s3 = makeStore(); let calls = 0, request;
  const v2Answer = { selected: 'A', confidence: 'MEDIUM', decidingFactor: 'recentUsage', blocker: 'NONE', reconsider: 'pick_ruled_out' };
  const provider = async (_u, args) => { calls++; request = JSON.parse(args.body); return new Response(JSON.stringify({ id: 'msg_v2', model: 'claude-sonnet-4-6', stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'tool_use', name: 'submit_decision', input: v2Answer }] }), { status: 200 }); };
  const fresh = await fast.runFastReview({ store: s3, decisionId, ownerHash, apiKey: 'k', selection, fetchImpl: provider, now });
  assert.equal(fresh.status, 'REVIEW_READY', JSON.stringify(fresh.validationErrors)); assert.equal(calls, 1);
  assert.equal(request.tools[0].input_schema.properties.tradeoffFactor, undefined);
  assert.ok(JSON.parse(request.messages[0].content).advantages, 'the model sees each player\'s advantages');
  assert.equal(budgetKeys(s3).length, 1, 'exactly one budget reservation');
  const again = await fast.runFastReview({ store: s3, decisionId, ownerHash, apiKey: 'k', selection, fetchImpl: provider, now });
  assert.equal(again.cached, true); assert.equal(calls, 1, 'deduplicated: no second provider call'); assert.equal(budgetKeys(s3).length, 1);
  assert.equal(fast.VERSION, 'rookie-fast-pair-v6-haiku', 'version label unchanged');
  passed++; console.log('  ok - a new v2 review: one provider call, one budget reservation, v2 schema; repeat is deduplicated');
  console.log('rookie-structured-pair-v2.test.js: ' + passed + ' passed');
})().catch(e => { console.error(e); process.exit(1); });
