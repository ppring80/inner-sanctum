'use strict';
const {buildMatchupDefense}=require('./weekly-sage-matchup-defense');
const {buildPlayerMatchup}=require('./weekly-sage-player-matchup');
const {handler:readDefenseSeason}=require('./weekly-sage-defense-season');
// Validated Blob evidence only: no provider calls and no per-player HTTP.
async function cachedMatchupsForPosition(event,{baseUrl,season,targetWeek,seasonType,schedule,position}){
 const response=await readDefenseSeason({...event,queryStringParameters:{season,week:String(targetWeek),seasonType}});
 const evidence=JSON.parse(response.body);
 const missing=evidence?.failedWeeks;
 const newestMissing=response.statusCode===502 && seasonType==='reg' && targetWeek>=3 &&
  missing?.length===1 && missing[0].week===targetWeek-1 &&
  missing[0].error===`Week ${targetWeek-1} cached defensive evidence is missing.`;
 if(response.statusCode!==200 && !newestMissing)throw Error(`Cached ${position} defense evidence unavailable: ${response.body}`);
 const defense=await buildMatchupDefense({baseUrl,season,week:targetWeek,seasonType,prebuiltDefenseSeason:newestMissing?null:evidence});
 const byTeam=new Map();
 return team=>{
  if(!byTeam.has(team))byTeam.set(team,buildPlayerMatchup({baseUrl,season,week:targetWeek,seasonType,team,position,prebuiltSchedule:schedule,prebuiltMatchupDefense:defense}));
  return byTeam.get(team);
 };
}
module.exports={cachedMatchupsForPosition};
