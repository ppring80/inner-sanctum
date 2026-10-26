"use strict";
const assert=require('assert/strict'),path=require('path'),fs=require('fs'),vm=require('vm'),Module=require('module');
const {memory}=require('./espn-synthetic-session.test');
(async()=>{const root=path.resolve(__dirname,'..');const env={SITE_ID:'synthetic-test',SAGE_ACCEPTANCE_SITE_ID:'synthetic-test',SAGE_ACCEPTANCE_MODE:'isolated',SAGE_ACCEPTANCE_ORIGIN:'https://synthetic-test.netlify.app'};const built=require('../scripts/prepare-sage-acceptance').prepare(root,env);await require('../scripts/prepare-espn-synthetic').prepare(root,built.out);
const ext=built.out+'/private-extension',manifest=JSON.parse(fs.readFileSync(ext+'/manifest.json'));assert.deepEqual(manifest.host_permissions,['https://sprightly-chebakia-13d478.netlify.app/*']);assert.ok(!JSON.stringify(manifest).includes('theinnersanctum.xyz'));assert.ok(!JSON.stringify(manifest).includes('fantasy.espn.com'));
let listener,queries=0;vm.runInNewContext(fs.readFileSync(ext+'/worker.js','utf8'),{URL,chrome:{runtime:{onMessage:{addListener:f=>listener=f}},tabs:{query:()=>{queries++;}}}});const r=await new Promise(resolve=>listener({type:'SYNTHETIC_CAPTURE',caseId:'synthetic-a'},{tab:{url:'https://theinnersanctum.xyz/connect-league'}},resolve));assert.equal(r.ok,false);assert.equal(queries,0);
const stores=new Map(),load=Module._load;Module._load=function(n,...rest){if(n==='@netlify/blobs')return{getStore:({name})=>{if(!stores.has(name))stores.set(name,memory());return stores.get(name);}};return load.call(this,n,...rest);};try{const {handler}=require(built.out+'/lib/acceptance/synthetic-runtime');const origin='https://sprightly-chebakia-13d478.netlify.app';
for(const o of ['https://theinnersanctum.xyz','https://evil.invalid',''])assert.equal((await handler({httpMethod:'POST',headers:{origin:o},body:'{"action":"begin"}'})).statusCode,403);
assert.equal((await handler({httpMethod:'POST',headers:{origin,authorization:'synthetic-production-token'},body:'{"action":"begin"}'})).statusCode,403);
assert.equal((await handler({httpMethod:'POST',headers:{origin},body:JSON.stringify({action:'upload',caseId:'synthetic-a',snapshot:{}})})).statusCode,401);
assert.ok([...stores.values()].every(s=>s.data.size===0));
}finally{Module._load=load;}
console.log('PASS generated variant rejects production origin; HTTP rejects foreign origins, imported tokens and unauthorized uploads without writes');})().catch(e=>{console.error(e);process.exitCode=1;});
