'use strict';
const profiles=require('./_club-news-profiles.json');
const {rosterSnapshot}=require('./_club-availability-reconciliation');
const {reserveBootstrap}=require('./_club-reserve-bootstrap');
const {discoverNews}=require('./_club-news-discovery');
const {reserveClaims}=require('./_club-reserve-claims');
async function collectSharedClub({club,read,previous,season,asOf}){
 const profile=profiles.find(candidate=>candidate.team===club.team);
 if(!profile)throw Error('Shared club news profile not qualified.');
 const sourceUrl=club.origin+'/team/players-roster/';
 const snapshot=rosterSnapshot(await read(sourceUrl),{team:club.team,sourceUrl,observedAt:asOf});
 const tableUrl=club.origin+`/team/transactions/${season}`;
 const history=reserveBootstrap(await read(tableUrl),snapshot,{season,sourceUrl:tableUrl,observedAt:asOf});
 const since=previous?.asOf?new Date(Date.parse(previous.asOf)-48*3600000).toISOString().slice(0,10):`${season}-${asOf.slice(5,7)}-01`;
 const unresolved=[];
 const discovery=await discoverNews({profile,read,since,asOf,previousSeen:previous?.discovery?.seenUrls||[],onArticle:article=>{
  unresolved.push(...reserveClaims(article.html,{...article,sourceUrl:article.card.url}));
 }});
 // An adapter recognizes sources, not every announcement wording. Unsupported
 // reserve claims block this team's coverage; no generic prose becomes an event.
 return {snapshot,events:history.events,discoveryComplete:discovery.discoveryPassed&&unresolved.length===0,
  discovery:{...discovery,seenUrls:discovery.articles.map(article=>article.url),unresolved,missingPlacementDates:history.missing.map(player=>player.name)}};
}
module.exports={collectSharedClub};
