"use strict";
const assert = require('node:assert/strict');
const {pairComparisons} = require('../netlify/functions/_super-sage-pair-comparisons');
const {validateClaims,withClaimAssessment} = require('../netlify/functions/_super-sage-rookie-claim-checks');
const {presentGeneralFacts,formatGroundedAnswer,validate,GROUNDED_SYSTEM,runFastReview} = require('../netlify/functions/_super-sage-shadow-fast-review');
const {hash} = require('../netlify/functions/_super-sage-shadow-llm');
const player = (id,name,position,points,positionRank,matchup) => ({id,name,position,facts:Object.entries({projection:{points},standing:{positionRank,tier:'FLEX'},matchup,stateChanges:[]}).map(([field,value])=>({factId:`${id}:${field}`,field,value}))});
const packet={requireSentenceEvidence:true,players:[player('A','Kendre Miller','RB',6.9,42,'Positive'),player('B','Tyler Higbee','TE',5.43,17,'Strong Positive')]};
const frozen={packet,evidenceHash:hash(JSON.stringify(packet))},before=JSON.stringify(frozen);
const view=presentGeneralFacts(frozen),c=view.packet.comparisons;
assert.equal(JSON.stringify(frozen),before);
assert.equal(c.projection.higherPlayerId,'A');
assert.equal(c.projection.difference,1.47);
assert.deepEqual(c.projection.values,[{playerId:'A',name:'Kendre Miller',points:6.9},{playerId:'B',name:'Tyler Higbee',points:5.43}]);
assert.equal(c.matchup.moreFavorablePlayerId,'B');
assert.equal(c.positionRanksComparable,false);
assert.equal(view.evidenceHash,hash(JSON.stringify(view.packet)));
assert.ok(!('selected' in c),'comparison facts never select a starter');
assert.ok(GROUNDED_SYSTEM.includes('never a preferred starter'));
const check=(text,error)=>assert.ok(validateClaims({explanation:text},packet).includes(error),text);
for(const text of ["Higbee's 1.5-point projection lead matters less than his target volume reliability and better matchup rating versus Miller's uncertain workload split.","Higbee has a higher projection.","Higbee's projection is higher.","Miller has the lower projection.","Higbee projects for more points."]) check(text,'projection_comparison_reversed');
check('Higbee is the stronger pick: he carries a higher position rank, an established high-volume role.','cross_position_rank_comparison');
check('Higbee is ranked higher than Miller.','cross_position_rank_comparison');
check("Higbee's projection is still lower and converting targets into points depends on unknown quarterback quality.",'unsupported_quarterback_disadvantage');
for(const text of ["Miller's 1.47-point projection lead is small.","Miller has a higher projection.","Higbee has the lower projection.","Higbee's projection is lower.","Higbee doesn't have a higher projection.","Their position ranks cannot be compared.","I lean Higbee despite Miller's projection lead because Higbee has the better matchup."]) assert.deepEqual(validateClaims({explanation:text},packet),[],text);
// No reliance on caller-provided comparison metadata: checks derive original facts.
const tampered={...packet,comparisons:{projection:{higherPlayerId:'B'}}};
assert.ok(validateClaims({explanation:"Higbee's projection lead is small."},tampered).includes('projection_comparison_reversed'));
const reversed={...packet,players:[packet.players[1],packet.players[0]]};
assert.equal(pairComparisons(reversed).projection.higherPlayerId,'A');
const equal={...packet,players:packet.players.map(p=>({...p,facts:p.facts.map(f=>f.field==='projection'?{...f,value:{points:5}}:f)}))};
assert.equal(pairComparisons(equal).projection.higherPlayerId,null);
assert.ok(validateClaims({explanation:"Miller's projection lead is small."},equal).includes('projection_comparison_reversed'));
const missing={...packet,players:packet.players.map(p=>({...p,facts:p.facts.filter(f=>f.field!=='projection')}))};
assert.equal(pairComparisons(missing).projection,undefined);
assert.equal(pairComparisons({players:[packet.players[0]]}),null);
const same={...packet,players:packet.players.map(p=>({...p,position:'RB'}))};
assert.equal(pairComparisons(same).positionRanksComparable,true);
assert.deepEqual(validateClaims({explanation:'Miller is ranked higher than Higbee.'},same),[]);
// Preserve the model's raw language and independent selection while rejecting
// the actual latest false claim at both answer and sentence assessment levels.
const raw={selected:'B',confidence:'MEDIUM',caveat:'His targets fell from eleven to six.',reconsider:'New pregame role information.',explanationSentences:[
 {text:'I lean Higbee because he has the better matchup.',factIds:['A:matchup','B:matchup']},
 {text:"Miller's projection is higher.",factIds:['A:projection','B:projection']},
 {text:"Higbee's 1.5-point projection lead matters less than his matchup.",factIds:['A:projection','B:projection','B:matchup']}
]};
const rawBefore=JSON.stringify(raw),answer=formatGroundedAnswer(raw);
assert.equal(JSON.stringify(raw),rawBefore);
assert.equal(answer.selected,'B');
assert.ok(validate(answer,packet).includes('projection_comparison_reversed'));
const assessment=withClaimAssessment({answer},packet).claimAssessment;
assert.ok(assessment.claims[2].issues.includes('projection_comparison_reversed'));
assert.equal(assessment.recommendation,'NOT_REVIEWED');
console.log('Comparison integrity: actual reversal, cross-position rank and unsupported QB claim rejected; identities, ties, missing facts, independent choice, raw history and sentence checks covered.');

(async()=>{
 const decisionId=hash('comparison-integrity-test'),ownerHash=hash('synthetic-owner');
 const parent={players:packet.players.map(p=>({...p,playerId:p.id})),slots:[{slotId:'S9',slotLabel:'FLEX',eligiblePositions:['RB','TE'],candidateIds:['A','B']}]};
 const original={ownerHash,capturedAt:'2026-10-15T01:54:09.335Z',frozenEvidence:{packet:parent,evidenceHash:hash(JSON.stringify(parent))}};
 const data=new Map([[`evidence/${decisionId}/${ownerHash}`,original]]),storedBefore=JSON.stringify(original);
 const store={get:async k=>data.get(k),setJSON:async(k,v,o={})=>{if(o.onlyIfNew&&data.has(k))return {modified:false};data.set(k,v);return {modified:true};}};
 let calls=0,outgoing;
 const args={store,decisionId,ownerHash,selection:{players:['Kendre Miller','Tyler Higbee'],slotId:'S9'},now:new Date('2026-10-15T03:00:00Z'),apiKey:'mock',fetchImpl:async(_url,o)=>{
   calls++;outgoing=JSON.parse(o.body);const sent=JSON.parse(outgoing.messages[0].content);
   assert.deepEqual(sent.comparisons,c);
   assert.equal(outgoing.model,'claude-sonnet-4-6');
   assert.equal(outgoing.max_tokens,550);
   return {ok:true,json:async()=>({stop_reason:'tool_use',content:[{type:'tool_use',name:'submit_decision',input:raw}]})};
 }};
 const result=await runFastReview(args);
 assert.equal(calls,1);
 assert.equal(result.status,'INVALID');
 assert.ok(result.validationErrors.includes('projection_comparison_reversed'));
 assert.equal(result.rawText,JSON.stringify(raw));
 assert.equal(result.answer.selected,'B');
 assert.equal(result.outgoing.evidenceHash,hash(outgoing.messages[0].content));
 assert.equal(result.rules.productionAuthority,false);
 assert.equal(JSON.stringify(original),storedBefore);
 assert.equal((await runFastReview(args)).cached,true);
 assert.equal(calls,1,'saved invalid output never triggers a retry');
 console.log('Mocked provider path: exact outgoing comparisons, fingerprint, raw response, invalid result, unchanged parent, private authority and no retry verified. No network call.');
})().catch(e=>{console.error(e);process.exitCode=1;});
