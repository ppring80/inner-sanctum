'use strict';
const {buildMatchupDefense}=require('./weekly-sage-matchup-defense');
const {buildPlayerMatchup}=require('./weekly-sage-player-matchup');
const {handler:readDefenseSeason}=require('./weekly-sage-defense-season');
// Validated Blob evidence only: no provider calls and no per-player HTTP.
async function cachedMatchupsForPosition(event,{baseUrl,season,targetWeek,seasonType,schedule,position}){
 const response=await readDefenseSeason({...event,queryStringParameters:{season,week:String(targetWeek),seasonType}});
 if(response.statusCode!==200)throw Error(`Cached ${position} defense evidence unavailable: ${response.body}`);
 const defense=await buildMatchupDefense({baseUrl,season,week:targetWeek,seasonType,prebuiltDefenseSeason:JSON.parse(response.body)});
 const byTeam=new Map();
 return team=>{
  if(!byTeam.has(team))byTeam.set(team,buildPlayerMatchup({baseUrl,season,week:targetWeek,seasonType,team,position,prebuiltSchedule:schedule,prebuiltMatchupDefense:defense}));
  return byTeam.get(team);
 };
}
module.exports={cachedMatchupsForPosition};
