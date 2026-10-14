'use strict';
const clubs=require('./_official-club-sources.json');
const {rosterSnapshot}=require('./_club-availability-reconciliation');
const saintsDiscovery=require('./_saints-announcement-discovery');
const {extractSaintsEvents}=require('./_saints-announcement-events');
const {settlementEvents}=require('./_saints-settlement-events');
const {reconcileReferences}=require('./_saints-reference-reconciliation');
// Collection adapters are deliberately observation-only until recurring announcement
// extraction and overlap contracts are qualified. They cannot pass discovery coverage.
const adapters=Object.fromEntries(clubs.map(club=>[club.team,async({read,asOf})=>{
 const sourceUrl=club.origin+'/team/players-roster/';
 const html=await read(sourceUrl);
 const observedAt=new Date().toISOString();
 return {snapshot:rosterSnapshot(html,{team:club.team,sourceUrl,observedAt}),events:[],discoveryComplete:false};
}]));
async function collectSaints({club,read,previous,season,asOf}){
 const sourceUrl=club.origin+'/team/players-roster/';
 const rosterHtml=await read(sourceUrl);
 const snapshot=rosterSnapshot(rosterHtml,{team:'NO',sourceUrl,observedAt:asOf});
 const cards=saintsDiscovery.indexCards(await read(saintsDiscovery.INDEX));
 const since=previous?.asOf?new Date(Date.parse(previous.asOf)-48*3600000).toISOString().slice(0,10):`${season}-${asOf.slice(5,7)}-01`;
 const settlementUrl=club.origin+`/team/transactions/${season}`;
 const settlements=settlementEvents(await read(settlementUrl),{season,sourceUrl:settlementUrl,observedAt:asOf});
 const articles=[],events=[...settlements.events],unresolved=[...settlements.unresolved];
 // All listed articles are inspected; title keywords cannot omit a new move.
 for(const card of cards){
  const html=await read(card.url),meta=saintsDiscovery.publication(html);
  if(Date.parse(meta.publishedAt)>Date.parse(asOf))throw Error('Saints publication after observation cutoff.');
  articles.push({...card,publishedAt:meta.publishedAt});
  if(meta.publishedAt.slice(0,10)<since)continue;
  const parsed=extractSaintsEvents(html,{sourceUrl:card.url,observedAt:asOf});
  if(parsed.announcement){events.push(...parsed.events);unresolved.push(...parsed.unresolved.map(r=>({...r,sourceUrl:card.url,articleDate:meta.publishedAt.slice(0,10)})));}
  else{
   // Unsupported explicit reserve actions must block coverage, even outside the
   // known alert series. No generic extraction is allowed to invent subjects.
   const body=[...html.matchAll(/<div\b[^>]*class=["'][^"']*nfl-c-body-part--text[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)].map(m=>m[1].replace(/<[^>]+>/g,' ')).join(' ');
   const reserveAction=/\b(?:placed|activated|reinstated|reverted)\b[^.!?]{0,220}\b(?:injured reserve|reserve\/injured|physically unable|non-football injury)\b|\b(?:released|waived)\b[^.!?]{0,220}\binjury settlements?\b/i;
   for(const sentence of body.replace(/\bJr\./g,'Jr__DOT__').split(/(?<=[.!?])\s+/).map(s=>s.replace(/Jr__DOT__/g,'Jr.'))){
    if(reserveAction.test(sentence))unresolved.push({sourceUrl:card.url,reason:'RESERVE_ACTION_OUTSIDE_QUALIFIED_ALERT_FORMAT',sourceText:sentence.replace(/\s+/g,' ').trim(),articleDate:meta.publishedAt.slice(0,10)});
   }
  }
 }
 const chronological=articles.every((a,i)=>!i||Date.parse(a.publishedAt)<=Date.parse(articles[i-1].publishedAt));
 const boundaryReached=articles.at(-1).publishedAt.slice(0,10)<since;
 const seenUrls=articles.map(a=>a.url);
 const overlapAnchorSeen=previous?.discovery?.seenUrls?.some(url=>seenUrls.includes(url))||false;
 const references=reconcileReferences(unresolved,[...(previous?.events||[]),...events]);
 const discoveryComplete=chronological&&boundaryReached&&references.unresolved.length===0&&(!previous||overlapAnchorSeen);
 return {snapshot,events,discoveryComplete,discovery:{since,chronological,boundaryReached,overlapAnchorSeen,bootstrap:!previous,seenUrls,unresolved:references.unresolved,corroborated:references.corroborated}};
}
adapters.NO=collectSaints;
const chargersDiscovery=require('./_chargers-news-discovery');
const {extractChargersEvents}=require('./_chargers-announcement-events');
async function collectChargers({club,read,previous,season,asOf}){
 const sourceUrl=club.origin+'/team/players-roster/';
 const snapshot=rosterSnapshot(await read(sourceUrl),{team:'LAC',sourceUrl,observedAt:asOf});
 const transactionHtml=await read(club.origin+`/team/transactions/${season}`);
 const cards=chargersDiscovery.indexCards(await read(chargersDiscovery.INDEX));
 const since=previous?.asOf?new Date(Date.parse(previous.asOf)-48*3600000).toISOString().slice(0,10):`${season}-${asOf.slice(5,7)}-01`;
 const articles=[],events=[],unresolved=[];
 for(const card of cards){
  const html=await read(card.url),meta=chargersDiscovery.publication(html);
  if(Date.parse(meta.publishedAt)>Date.parse(asOf))throw Error('Chargers publication after observation cutoff.');
  articles.push({...card,publishedAt:meta.publishedAt});
  if(meta.publishedAt.slice(0,10)<since&&(!meta.modifiedAt||meta.modifiedAt.slice(0,10)<since))continue;
  const parsed=extractChargersEvents(html,{sourceUrl:card.url,observedAt:asOf,roster:snapshot,transactionHtml});
  if(parsed.announcement){events.push(...parsed.events);unresolved.push(...parsed.unresolved.map(r=>({...r,sourceUrl:card.url})));}
  else {for(const [,block]of html.matchAll(/<div\b[^>]*class=["'][^"']*nfl-c-body-part--text[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)){for(const [,paragraph]of block.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)){const text=paragraph.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();if(/\b(?:placed|put|activated|reinstated)\b[^!?]{0,220}\b(?:injured reserve|reserve\/injured|physically unable|non-football injury)\b/i.test(text))unresolved.push({sourceUrl:card.url,reason:'RESERVE_ACTION_OUTSIDE_QUALIFIED_CHARGERS_FORMAT',sourceText:text,articleDate:meta.publishedAt.slice(0,10)});}}}
 }
 const chronological=articles.every((a,i)=>!i||Date.parse(a.publishedAt)<=Date.parse(articles[i-1].publishedAt));
 const boundaryReached=articles.at(-1).publishedAt.slice(0,10)<since,seenUrls=articles.map(a=>a.url);
 const overlapAnchorSeen=previous?.discovery?.seenUrls?.some(url=>seenUrls.includes(url))||false;
 const references=require('./_chargers-reference-reconciliation').reconcileChargersReferences(unresolved,events);
 return {snapshot,events,discoveryComplete:chronological&&boundaryReached&&!references.unresolved.length&&(!previous||overlapAnchorSeen),discovery:{since,chronological,boundaryReached,seenUrls,overlapAnchorSeen,unresolved:references.unresolved,corroborated:references.corroborated,hypothetical:references.hypothetical}};
}
adapters.LAC=collectChargers;
const {collectDallas}=require('./_dallas-availability-adapter');
adapters.DAL=collectDallas;
const {collectEagles}=require('./_eagles-availability-adapter');
adapters.PHI=collectEagles;
module.exports={adapters,collectSaints,collectChargers,collectDallas,collectEagles};
