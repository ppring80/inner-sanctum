'use strict';
// Uses the same short-lived workflow identity already trusted by the worker.
// An accepted background request is not a completed collection or activation.
const ORIGIN='https://theinnersanctum.xyz';
async function startClubCollection({token,fetchImpl=fetch,now=Date.now()}={}){
 if(typeof token!=='string'||!token)throw Error('Workflow identity token missing.');
 const response=await fetchImpl(ORIGIN+'/.netlify/functions/weekly-sage-status',{signal:AbortSignal.timeout(15000)});
 if(!response.ok)return {requested:false,reason:'PRODUCTION_STATUS_UNAVAILABLE'};
 const status=await response.json(),club=status.clubAvailability;
 if(club?.enabled!==true)return {requested:false,reason:'CLUB_COLLECTION_DISABLED'};
 const oldest=Date.parse(club.observations?.oldestObservedAt||'');
 if(club.observations?.freshRosterCoverage===true&&Number.isFinite(oldest)&&oldest<=now&&now-oldest<50*60000)return {requested:false,reason:'RECENT_ROSTER_OBSERVATIONS'};
 const request=await fetchImpl(ORIGIN+'/.netlify/functions/refresh-club-availability-background',{
  method:'POST',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)
 });
 if(request.status!==202)throw Error('Official club background request was not accepted (HTTP '+request.status+').');
 return {requested:true,accepted:true,collectionVerified:false,customerReadsEnabled:club.customerReadsEnabled===true};
}
module.exports={startClubCollection};
