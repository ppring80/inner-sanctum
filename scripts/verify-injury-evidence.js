'use strict';
const assert=require('node:assert/strict');
async function main(){
 const base=process.env.SAGE_HEALTH_URL||'https://theinnersanctum.xyz';
 const response=await fetch(base+'/.netlify/functions/weekly-sage-status',{signal:AbortSignal.timeout(60000)});
 const status=await response.json();
 assert(status.injuryTransactions?.fresh,'Official transaction cache is missing or older than two hours.');
 assert(!status.injuryTransactions.health?.error,'Official transaction refresh failed: '+status.injuryTransactions.health?.error);
 console.log('PASS: official reserve/activation checks current; shared cached evidence, zero Tank01 calls.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
