'use strict';
// Read-only measurement; input remains outside the repository.
const fs=require('node:fs');
const {hash}=require('../netlify/functions/_super-sage-shadow-llm');
const v1=require('../netlify/functions/_rookie-lineup-candidate');
const v2=require('../netlify/functions/_rookie-lineup-candidate-v2');
function measure(frozen){
 const before=v1.buildRequest(frozen),after=v2.buildRequest(frozen),view=JSON.parse(after.messages[0].content);
 const restored=v2.untables(v2.expand(view));
 if(hash(JSON.stringify(restored))!==frozen.evidenceHash)throw Error('round_trip_failure');
 const size=r=>Buffer.byteLength(JSON.stringify(r)),priorBytes=size(before),candidateBytes=size(after);
 return {parentEvidenceHash:frozen.evidenceHash,priorRequestHash:hash(JSON.stringify(before)),candidateRequestHash:hash(JSON.stringify(after)),priorBytes,candidateBytes,reductionPercent:Number((100*(1-candidateBytes/priorBytes)).toFixed(2)),players:restored.players.length,slots:restored.slots.length,facts:restored.players.reduce((n,p)=>n+p.facts.length,0),requiredAlerts:view.requiredAlerts.length,dictionaryEntries:view.dictionary.length,losslessRoundTrip:true,maxTokens:after.max_tokens,liveTokens:null,liveLatencyMs:null};
}
if(require.main===module){const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));console.log(JSON.stringify(measure(input.frozenEvidence||input),null,2));}
module.exports={measure};
