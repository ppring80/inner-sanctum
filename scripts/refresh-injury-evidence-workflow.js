'use strict';
const {AUDIENCE}=require('../netlify/functions/_injury-workflow-auth');
async function main(){
 const url=process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
 const requestToken=process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
 if(!url||!requestToken)throw Error('GitHub workflow identity permission is missing.');
 const identityUrl=new URL(url);identityUrl.searchParams.set('audience',AUDIENCE);
 const identity=await fetch(identityUrl,{headers:{Authorization:'Bearer '+requestToken},signal:AbortSignal.timeout(15000)});
 if(!identity.ok)throw Error('GitHub workflow identity request failed.');
 const {value}=await identity.json();if(!value)throw Error('GitHub workflow identity token missing.');
 // The short-lived token is never printed or persisted.
 for(let attempt=0;attempt<9;attempt++){
  const response=await fetch('https://theinnersanctum.xyz/.netlify/functions/refresh-injury-transactions',{headers:{Authorization:'Bearer '+value},signal:AbortSignal.timeout(30000)});
  if(response.ok){console.log(await response.text());return;}
  if(attempt===8)throw Error('Official injury refresh failed: HTTP '+response.status);
  await new Promise(resolve=>setTimeout(resolve,15000));
 }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
