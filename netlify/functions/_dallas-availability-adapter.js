'use strict';
const discovery=require('./_dallas-announcement-discovery');
const {publication}=require('./_saints-announcement-discovery');
const {rosterSnapshot}=require('./_club-availability-reconciliation');
const {extractDallasEvents}=require('./_dallas-announcement-events');
const {updateEntries}=require('./_dallas-update-entries');
async function collectDallas({club,read,previous,season,asOf}){
 const sourceUrl=club.origin+'/team/players-roster/';
 const snapshot=rosterSnapshot(await read(sourceUrl),{team:'DAL',sourceUrl,observedAt:asOf});
 const frozenHistory=require('./_dallas-verified-reserve-history.json');
 const bootstrap=season===frozenHistory.season&&snapshot.rows.some(p=>p.status==='RESERVE_RETURN_PROCESS'&&['Marist Liufau','Devin Moore'].includes(p.name))?require('./_dallas-reserve-bootstrap').bootstrapDallas(frozenHistory.html,{sourceUrl:frozenHistory.sourceUrl,season,observedAt:frozenHistory.sourceObservedAt,snapshot}):{events:[],unresolved:[]};
 const first=await read(discovery.INDEX),module=discovery.indexModule(first);
 const since=previous?.asOf?new Date(Date.parse(previous.asOf)-48*3600000).toISOString().slice(0,10):`${season}-${asOf.slice(5,7)}-01`;
 const articles=[],events=[...bootstrap.events],unresolved=[...bootstrap.unresolved],datedUpdates=[];let boundaryReached=false,chronological=true,pages=0;
 for(let page=1;page<=5;page++){
  const html=page===1?first:await read(discovery.pageUrl(module,page));pages++;
  const urls=discovery.pageCards(html,{seen:articles.map(a=>a.url)});
  for(const url of urls){
   const content=await read(url),meta=publication(content);
   if(Date.parse(meta.publishedAt)>Date.parse(asOf))throw Error('Dallas publication after observation cutoff.');
   const prior=articles.at(-1);if(prior&&Date.parse(meta.publishedAt)>Date.parse(prior.publishedAt))chronological=false;
   articles.push({url,publishedAt:meta.publishedAt});
   const extracted=extractDallasEvents(content,{sourceUrl:url,season,observedAt:asOf,snapshot});events.push(...extracted.events);unresolved.push(...extracted.unresolved);
   if(/\/news\/updates-[a-z]+-\d{4}$/.test(new URL(url).pathname)){
    const entries=updateEntries(content,{sourceUrl:url,season,observedAt:asOf});
    const inWindow=entries.entries.filter(e=>e.reportedAt>=since);datedUpdates.push(...inWindow);
    for(const entry of inWindow)if(/injured reserve|reserve\/injured|\bir\b|physically unable|non-football injury/i.test(entry.sourceText))unresolved.push({...entry,reason:'DATED_DALLAS_UPDATE_REQUIRES_QUALIFIED_EXTRACTION'});
    unresolved.push(...entries.unresolved.map(e=>({...e,sourceUrl:url})));
   }
   if(meta.publishedAt.slice(0,10)<since||/\/news\/updates-[a-z]+-\d{4}$/.test(new URL(url).pathname))continue;
   for(const [,body]of content.matchAll(/<div\b[^>]*class=["'][^"']*nfl-c-body-part--text[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)){
    const plain=body.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
    for(const text of plain.replace(/\b(?:Jr|Sr|[A-Z])\./g,m=>m.replace('.','__DOT__')).split(/(?<=[.!?])\s+/).map(s=>s.replace(/__DOT__/g,'.'))){
     if(/\b(?:placed|put|activated|reinstated|reverted)\b[^!?]{0,220}\b(?:injured reserve|reserve\/injured|\bir\b|physically unable|non-football injury)\b/i.test(text))unresolved.push({sourceUrl:url,reason:'DALLAS_RESERVE_CLAIM_REQUIRES_QUALIFIED_EXTRACTION',sourceText:text,articleDate:meta.publishedAt.slice(0,10)});
    }
   }
  }
  if(articles.at(-1).publishedAt.slice(0,10)<since){boundaryReached=true;break;}
 }
 const audit=require('./_dallas-reference-reconciliation').reconcileDallasReferences(unresolved,events,snapshot);
 const seenUrls=articles.map(a=>a.url),overlapAnchorSeen=previous?.discovery?.seenUrls?.some(url=>seenUrls.includes(url))||false;
 return {snapshot,events,discoveryComplete:chronological&&boundaryReached&&!audit.unresolved.length&&(!previous||overlapAnchorSeen),discovery:{since,pages,chronological,boundaryReached,seenUrls,overlapAnchorSeen,unresolved:audit.unresolved,corroborated:audit.corroborated,excluded:audit.excluded,quarantined:audit.quarantined,datedUpdates}};
}
module.exports={collectDallas};
