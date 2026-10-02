'use strict';
const crypto=require('node:crypto');
const ISSUER='https://token.actions.githubusercontent.com';
const AUDIENCE='https://theinnersanctum.xyz/injury-refresh';
const WORKFLOW='ppring80/inner-sanctum/.github/workflows/injury-evidence-health.yml@refs/heads/main';
let cachedKeys=null;
async function verifyWorkflowToken(token,options={}){
 try{
  if(typeof token!=='string'||token.length>20000)return false;
  const parts=token.split('.');if(parts.length!==3)return false;
  const header=JSON.parse(Buffer.from(parts[0],'base64url'));
  const claims=JSON.parse(Buffer.from(parts[1],'base64url'));
  const now=Math.floor((options.now??Date.now())/1000);
  if(header.alg!=='RS256'||typeof header.kid!=='string'||claims.iss!==ISSUER||claims.aud!==AUDIENCE||claims.repository!=='ppring80/inner-sanctum'||String(claims.repository_id)!=='1260917761'||claims.ref!=='refs/heads/main'||claims.workflow_ref!==WORKFLOW||!['schedule','workflow_dispatch','workflow_run'].includes(claims.event_name)||!Number.isFinite(claims.exp)||claims.exp<=now||!Number.isFinite(claims.nbf)||claims.nbf>now+30)return false;
  let keys=options.keys;
  if(!keys){
   if(!cachedKeys||cachedKeys.until<Date.now()||!cachedKeys.keys.some(k=>k.kid===header.kid)){
    const response=await fetch(ISSUER+'/.well-known/jwks',{signal:AbortSignal.timeout(12000)});
    if(!response.ok)return false;const body=await response.json();if(!Array.isArray(body.keys))return false;
    cachedKeys={keys:body.keys,until:Date.now()+3600000};
   }
   keys=cachedKeys.keys;
  }
  const jwk=keys.find(k=>k.kid===header.kid&&k.kty==='RSA'&&(!k.use||k.use==='sig'));
  if(!jwk)return false;
  return crypto.verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),crypto.createPublicKey({key:jwk,format:'jwk'}),Buffer.from(parts[2],'base64url'));
 }catch{return false;}
}
module.exports={AUDIENCE,ISSUER,WORKFLOW,verifyWorkflowToken};
