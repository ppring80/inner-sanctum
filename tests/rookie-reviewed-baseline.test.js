"use strict";
// Reviewed live response from 2026-10-15T03:07:56.984Z, not an assistant rewrite.
// Pin the working contract so a wording edit cannot silently replace it.
const assert=require('node:assert/strict');
const {hash}=require('../netlify/functions/_super-sage-shadow-llm');
const {GROUNDED_SYSTEM,formatGroundedAnswer,validate}=require('../netlify/functions/_super-sage-shadow-fast-review');
assert.equal(hash(GROUNDED_SYSTEM),'27011204be8061be090238db5ae04183ba14a1370be4ada3b6a8882416c10780','Working general prompt changed: compare against the reviewed live response before updating this baseline.');
const raw={selected:'A',confidence:'MEDIUM',caveat:"Miller's backfield role is unconfirmed with Kamara's status unclear.",reconsider:'If Alvin Kamara is confirmed active and expected to dominate carries.',explanationSentences:[
 {text:"Miller projects at 6.9 points versus Higbee's 5.43, and his carries plus targets have grown to 10 in his last game, averaging nearly 9 over three weeks.",factIds:['A:projection','B:projection','A:observedOpportunity','A:observedCarries']},
 {text:"Higbee holds the stronger matchup rating and averages about 7.7 targets over three games as a high-volume role player, making him the safer volume bet if Miller's workload shrinks.",factIds:['B:matchup','A:matchup','B:observedTargets','B:establishedRole']},
 {text:"Miller's roughly 1.5-point projection edge and a positive matchup tip the balance his way, though Kamara's unknown status means his workload share could drop without warning.",factIds:['A:projection','B:projection','A:matchup','A:backfieldContext']}
]};
// Minimal fact fixture for testing known factual relationships. This is not the
// full private frozen request; its hash must never be presented as the live hash.
const make=(id,name,position,values)=>({id,name,position,facts:Object.entries(values).map(([field,value])=>({factId:`${id}:${field}`,field,value}))});
const packet={requireSentenceEvidence:true,players:[
 make('A','Kendre Miller','RB',{projection:{points:6.9},matchup:'Positive',standing:{positionRank:42,tier:'FLEX'},observedOpportunity:{avgLast3:8.67},observedCarries:{avgLast3:6.67},backfieldContext:{roleOrderVerified:false}}),
 make('B','Tyler Higbee','TE',{projection:{points:5.43},matchup:'Strong Positive',standing:{positionRank:17,tier:'FLEX'},observedTargets:{avgLast3:7.67},establishedRole:{}})
]};
const answer=formatGroundedAnswer(raw);
assert.deepEqual(validate(answer,packet),[],'A change now rejects the reviewed live response; investigate before replacing the checkpoint.');
const reversed=JSON.parse(JSON.stringify(raw));
reversed.explanationSentences[2].text="Higbee's 1.5-point projection lead tips the balance his way.";
assert.ok(validate(formatGroundedAnswer(reversed),packet).includes('projection_comparison_reversed'));
assert.equal(answer.selected,'A');
assert.equal(answer.explanationSentences[2].text,raw.explanationSentences[2].text);
console.log('Reviewed live baseline: exact general prompt pinned, actual model sentences preserved, factual reversal remains rejected. This fixture does not grant customer release approval or prove conversational quality.');
