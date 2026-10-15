'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {hash,fullRequest}=require('../netlify/functions/_super-sage-shadow-llm');
const packet={players:[{playerId:'P1',name:'Synthetic Back',position:'RB',facts:[{factId:'P1:projection',field:'projection',value:{points:7}}]}],slots:[{slotId:'S1',slotLabel:'RB',eligiblePositions:['RB'],candidateIds:['P1']}]};
const request=fullRequest(packet,'claude-sonnet-4-6'),frozenEvidence={packet,evidenceHash:hash(JSON.stringify(packet))};
const payload={decisionId:'a'.repeat(64),frozenEvidence,review:{model:'claude-sonnet-4-6',evidenceHash:frozenEvidence.evidenceHash,requestId:'synthetic-only',outgoing:{systemHash:hash(request.system),evidenceHash:hash(request.messages[0].content),schemaHash:hash(JSON.stringify(request.tools[0].input_schema)),maxTokens:request.max_tokens}}};
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rookie-measure-')),file=path.join(dir,'synthetic.json'),script=path.resolve(__dirname,'../scripts/measure-rookie-lineup-candidate.js');
const run=value=>{fs.writeFileSync(file,JSON.stringify(value));return spawnSync(process.execPath,['-e',`global.fetch=()=>{throw Error('Network forbidden in offline measurement');};process.argv=[process.execPath,${JSON.stringify(script)},${JSON.stringify(file)}];require(${JSON.stringify(script)});`],{encoding:'utf8'});};
try {
 const result=run(payload);assert.equal(result.status,0,result.stderr);const measured=JSON.parse(result.stdout);
 assert.equal(measured.originalEvidenceRoundTripExact,true);assert.equal(measured.playerCount,1);assert.equal(measured.slotCount,1);
 assert.ok(Object.values(measured.savedRequestComponentChecks).every(Boolean));assert.equal(measured.candidateTokenCount,null);assert.equal(measured.candidateLiveLatency,null);
 assert.ok(!result.stdout.includes('Synthetic Back'),'report does not dump the private input');
 const changed=JSON.parse(JSON.stringify(payload));changed.review.outgoing.schemaHash='bad';assert.notEqual(run(changed).status,0);
 const corrupt=JSON.parse(JSON.stringify(payload));corrupt.frozenEvidence.packet.players[0].name='Changed';assert.notEqual(run(corrupt).status,0);
 assert.notEqual(run({}).status,0);
 console.log('Candidate measurement: real request-component fingerprints, exact round trip, corruption rejection, summary-only output, no network and no invented token/latency claims. Synthetic local fixture.');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
