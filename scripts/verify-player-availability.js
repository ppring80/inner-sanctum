'use strict';
const {MODE}=require('../netlify/functions/_tank01-player-cache');
function verify(data,now=Date.now()){
 const age=now-Date.parse(data?.updatedAt||'');
 if(data?.availabilityMode!==MODE||data.teamsSucceeded!==32||data.teamsFailed!==0||Object.keys(data.players||{}).length<1000||!Number.isFinite(age)||age<0||age>=8*3600000)throw Error('Tank01 full-player availability is missing, incomplete or stale.');
 return {source:data.source,updatedAt:data.updatedAt,players:Object.keys(data.players).length};
}
async function main(){const r=await fetch('https://theinnersanctum.xyz/.netlify/functions/player-data',{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Availability cache unavailable');console.log('PASS Tank01 injury availability '+JSON.stringify(verify(await r.json())));}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={verify};
