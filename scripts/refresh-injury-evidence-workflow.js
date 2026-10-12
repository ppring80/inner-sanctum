'use strict';
const {AUDIENCE}=require('../netlify/functions/_injury-workflow-auth');
async function recover({token,fetchImpl=fetch,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),attempts=9}={}){
 for(let attempt=0;attempt<attempts;attempt++){
  const response=await fetchImpl('https://theinnersanctum.xyz/.netlify/functions/injury-evidence-recovery',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});
  // HTTP 202 means another collector holds the lease, not fresh evidence.
  if(response.status===200){
   const statusResponse=await fetchImpl('https://theinnersanctum.xyz/.netlify/functions/weekly-sage-status',{signal:AbortSignal.timeout(30000)});
   if(statusResponse.ok){const status=await statusResponse.json();if(status.injuryTransactions?.fresh&&!status.injuryTransactions.health?.error)return {fresh:true,checkedAt:status.injuryTransactions.checkedAt};}
  }
  if(attempt+1===attempts)throw Error('Official injury recovery did not produce verified fresh evidence.');
  await wait(15000);
 }
}
async function main(){
 const url=process.env.ACTIONS_ID_TOKEN_REQUEST_URL,requestToken=process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
 if(!url||!requestToken)throw Error('GitHub workflow identity permission is missing.');
 const identityUrl=new URL(url);identityUrl.searchParams.set('audience',AUDIENCE);
 const identity=await fetch(identityUrl,{headers:{Authorization:'Bearer '+requestToken},signal:AbortSignal.timeout(15000)});
 if(!identity.ok)throw Error('GitHub workflow identity request failed.');
 const {value}=await identity.json();if(!value)throw Error('GitHub workflow identity token missing.');
 console.log(JSON.stringify(await recover({token:value})));
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={recover};
