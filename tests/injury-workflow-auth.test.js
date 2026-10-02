'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),Module=require('node:module');
const {ISSUER,AUDIENCE,WORKFLOW,verifyWorkflowToken}=require('../netlify/functions/_injury-workflow-auth');
async function main(){
 const {publicKey,privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
 const jwk={...publicKey.export({format:'jwk'}),kid:'fixture',use:'sig'};
 const now=Date.now(),seconds=Math.floor(now/1000);
 const claims={iss:ISSUER,aud:AUDIENCE,repository:'ppring80/inner-sanctum',repository_id:'1260917761',ref:'refs/heads/main',workflow_ref:WORKFLOW,event_name:'workflow_run',nbf:seconds-1,exp:seconds+300};
 function token(changes={},header={alg:'RS256',kid:'fixture'}){const body=[header,{...claims,...changes}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');return body+'.'+crypto.sign('RSA-SHA256',Buffer.from(body),privateKey).toString('base64url');}
 assert(await verifyWorkflowToken(token(),{now,keys:[jwk]}));
 for(const changes of [{iss:'https://attacker.invalid'},{aud:'other'},{repository:'attacker/inner-sanctum'},{repository_id:'999'},{ref:'refs/pull/151/merge'},{workflow_ref:'ppring80/inner-sanctum/.github/workflows/other.yml@refs/heads/main'},{event_name:'pull_request'},{exp:seconds-1},{nbf:seconds+100}])assert.equal(await verifyWorkflowToken(token(changes),{now,keys:[jwk]}),false,JSON.stringify(changes));
 assert.equal(await verifyWorkflowToken(token({}, {alg:'none',kid:'fixture'}),{now,keys:[jwk]}),false);
 assert.equal(await verifyWorkflowToken(token({}, {alg:'RS256',kid:'unknown'}),{now,keys:[jwk]}),false);
 const valid=token();assert.equal(await verifyWorkflowToken(valid.slice(0,-10)+'AAAAAAAAAA',{now,keys:[jwk]}),false,'invalid signature rejected');
 let reads=0,keyRequests=0;const originalLoad=Module._load,originalFetch=global.fetch;
 Module._load=function(name,...args){return name==='@netlify/blobs'?{connectLambda(){},getStore:()=>({get:async()=>{reads++;return {checkedAt:new Date().toISOString()};}})}:originalLoad.call(this,name,...args);};
 let handler;try{delete require.cache[require.resolve('../netlify/functions/refresh-injury-transactions')];delete require.cache[require.resolve('../netlify/functions/injury-evidence-recovery')];handler=require('../netlify/functions/injury-evidence-recovery').handler;}finally{Module._load=originalLoad;}
 global.fetch=async url=>{keyRequests++;assert.equal(url,ISSUER+'/.well-known/jwks','fixed trusted key source only');return {ok:true,json:async()=>({keys:[jwk]})};};
 try{const accepted=await handler({httpMethod:'GET',headers:{authorization:'Bearer '+valid}});assert.equal(accepted.statusCode,200);assert.equal(reads,1);assert.equal(keyRequests,1);assert.equal(JSON.parse(accepted.body).skipped,true,'workflow cannot bypass freshness skip');const denied=await handler({httpMethod:'GET',headers:{authorization:'Bearer '+token({ref:'refs/heads/attacker'})}});assert([401,503].includes(denied.statusCode));assert.equal(reads,1,'untrusted workflow cannot access cache or initiate provider calls');const spoofed=await handler({httpMethod:'POST',headers:{},body:JSON.stringify({next_run:new Date().toISOString()})});assert([401,503].includes(spoofed.statusCode));assert.equal(reads,1,'HTTP route rejects scheduler-shaped unauthenticated bodies');}finally{global.fetch=originalFetch;}
 console.log('PASS: signed workflow identity, fixed issuer/audience/repository/main workflow, expiry and signature checks, protected collector, fresh skip; no stored secret or Tank01 access.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
