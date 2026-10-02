'use strict';
const assert=require('assert');
const {pack,context}=require('./fixtures/weekly-wr-cached-matchup.json');
const {buildWrFinalScore}=require('../netlify/functions/weekly-sage-wr-final-score');
const {buildMatchupDefense}=require('../netlify/functions/weekly-sage-matchup-defense');
const {buildPlayerMatchup}=require('../netlify/functions/weekly-sage-player-matchup');
async function main(){
 const saved=global.fetch;
 try{
  const defense=await buildMatchupDefense({season:String(pack.season),week:pack.week,seasonType:'reg',prebuiltDefenseSeason:context.defense});
  const snapshot={evidenceType:'weekly-sage-wr-snapshot',population:pack.population,nextStep:{ready:true}};
  const player=pack.population.find(p=>context.schedule.games.some(g=>g.home===p.team||g.away===p.team));assert(player);
  const matchup=await buildPlayerMatchup({season:String(pack.season),week:pack.week,seasonType:'reg',team:player.team,position:'WR',prebuiltSchedule:context.schedule,prebuiltMatchupDefense:defense});
  let calls=0;global.fetch=async()=>{calls++;return {ok:true,status:200,json:async()=>matchup};};
  const args={baseUrl:'https://fixture.invalid',season:String(pack.season),targetWeek:pack.week,seasonType:'reg',playerID:player.playerID,prebuiltSnapshot:snapshot};
  const original=await buildWrFinalScore(args);assert.equal(calls,1);
  global.fetch=async()=>{throw Error('HTTP must not run with cached matchup evidence');};
  const cached=await buildWrFinalScore({...args,prebuiltMatchup:matchup});const stable=value=>JSON.parse(JSON.stringify(value,(key,item)=>key==='generatedAt'?undefined:item));assert.deepStrictEqual(stable(cached),stable(original));
  await assert.rejects(buildWrFinalScore({...args,prebuiltMatchup:{evidenceType:'invalid'}}),/matchup|schema|Unexpected/i);
 }finally{global.fetch=saved;}
 console.log('Cached WR matchup preserves the full score result and requires zero HTTP calls.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
