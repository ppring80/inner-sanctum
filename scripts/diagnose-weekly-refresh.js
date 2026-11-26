'use strict';
// Existing GitHub workflow identity only. Never print its token or fetch providers.
function verifyRecoveryHealth(data){
 const blockers=[];
 if(data.runtime?.productionContext!==true)blockers.push('production_context');
 if(data.runtime?.recoverySigningConfigured!==true)blockers.push('recovery_signing_configuration');
 if(data.runtime?.providerConfigured!==true)blockers.push('provider_configuration');
 for(const job of ['refresh-player-data','refresh-weekly-projections']){
  const row=data.jobs?.find(row=>row.job===job);
  if(!row||row.ready!==true)blockers.push(job);
 }
 return {status:blockers.length?'FAIL':'PASS',blockers};
}
async function main(){
 const request=process.env.ACTIONS_ID_TOKEN_REQUEST_URL,auth=process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
 if(!request||!auth)throw Error('GitHub workflow identity is unavailable.');
 const tokenUrl=new URL(request);tokenUrl.searchParams.set('audience','https://theinnersanctum.xyz/injury-refresh');
 const identity=await fetch(tokenUrl,{headers:{Authorization:'Bearer '+auth},signal:AbortSignal.timeout(15000)});
 if(!identity.ok)throw Error('Workflow identity request failed: HTTP '+identity.status);
 const token=(await identity.json()).value;if(!token)throw Error('Workflow identity response was incomplete.');
 for(let attempt=0;attempt<6;attempt++){
  const response=await fetch('https://theinnersanctum.xyz/.netlify/functions/weekly-sage-status?diagnostics=refresh',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(25000)});
  const data=await response.json();
  if(response.ok&&Array.isArray(data.budgetDays)){
   console.log('WEEKLY_REFRESH_DIAGNOSTICS '+JSON.stringify(data));
   const health=verifyRecoveryHealth(data);console.log('WEEKLY_RECOVERY_HEALTH '+JSON.stringify(health));
   if(health.status==='FAIL')process.exitCode=1;return;
  }
  if(attempt===5)throw Error('Refresh diagnostic unavailable: HTTP '+response.status);
  // CI can finish before Netlify publishes the same main commit. Read-only wait.
  await new Promise(resolve=>setTimeout(resolve,5000));
 }
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={main,verifyRecoveryHealth};
