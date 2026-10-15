'use strict';
const discovery=require('./_eagles-announcement-discovery');
const {rosterSnapshot}=require('./_club-availability-reconciliation');
const {bootstrapEagles}=require('./_eagles-reserve-bootstrap');
const {canonicalNameKey}=require('../../player-identity');
async function collectEagles({club,read,previous,season,asOf}){
 const sourceUrl=club.origin+'/team/players-roster/';
 const snapshot=rosterSnapshot(await read(sourceUrl),{team:'PHI',sourceUrl,observedAt:asOf});
 const tableUrl=club.origin+`/team/transactions/${season}`;
 const historical=bootstrapEagles(await read(tableUrl),{sourceUrl:tableUrl,season,observedAt:asOf,snapshot});
 const events=[...historical.events],unresolved=[],quarantined=[];
 for(const claim of historical.unresolved){
  if(claim.names?.length&&claim.names.every(name=>!snapshot.rows.some(p=>canonicalNameKey(p.name)===canonicalNameKey(name))))quarantined.push({...claim,sourceUrl:tableUrl,status:null,createsEvent:false,customerEligible:false});
  else unresolved.push({...claim,sourceUrl:tableUrl});
 }
 const cards=discovery.indexCards(await read(discovery.INDEX)),articles=[];
 const since=previous?.asOf?new Date(Date.parse(previous.asOf)-48*3600000).toISOString().slice(0,10):`${season}-${asOf.slice(5,7)}-01`;
 for(const card of cards){
  let sectionSubject=null;
  const html=await read(card.url),meta=discovery.publication(html);
  if(Date.parse(meta.publishedAt)>Date.parse(asOf))throw Error('Eagles publication after observation cutoff.');
  articles.push({...card,publishedAt:meta.publishedAt});
  if(meta.publishedAt.slice(0,10)<since)continue;
  for(const [,body]of html.matchAll(/<div\b[^>]*class=["'][^"']*nfl-c-body-part--text[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)){
   const plain=body.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
   if(/^\s*<h[2-4]\b/i.test(body)){
    const label=/^(DB|CB|S|FS|SS|TE|G|OL|C|T|RB|WR|QB|LB|DL|DE|DT)\s+(.+)$/.exec(plain);
    const matches=label?snapshot.rows.filter(p=>canonicalNameKey(p.name)===canonicalNameKey(label[2])&&require('./_club-position-identity').compatiblePosition(p.position,label[1])):[];
    sectionSubject=matches.length===1?matches[0].name:null;
   }
   for(const text of plain.replace(/\b(?:Jr|Sr|[A-Z])\./g,m=>m.replace('.','__DOT__')).split(/(?<=[.!?])\s+/).map(s=>s.replace(/__DOT__/g,'.'))){
    if(/\b(?:placed|put|activated|reinstated|reverted)\b[^!?]{0,220}\b(?:injured reserve|reserve\/injured|\bir\b|physically unable|non-football injury)\b/i.test(text))unresolved.push({sourceUrl:card.url,reason:'EAGLES_RESERVE_CLAIM_REQUIRES_QUALIFIED_EXTRACTION',sourceText:text,sectionSubject,articleDate:meta.publishedAt.slice(0,10)});
   }
  }
 }
 const audit=require('./_eagles-reference-reconciliation').reconcileEaglesReferences(unresolved,events);
 const chronological=articles.every((a,i)=>!i||Date.parse(a.publishedAt)<=Date.parse(articles[i-1].publishedAt));
 const boundaryReached=articles.at(-1).publishedAt.slice(0,10)<since,seenUrls=articles.map(a=>a.url),overlapAnchorSeen=previous?.discovery?.seenUrls?.some(url=>seenUrls.includes(url))||false;
 return {snapshot,events,discoveryComplete:chronological&&boundaryReached&&!audit.unresolved.length&&(!previous||overlapAnchorSeen),discovery:{since,chronological,boundaryReached,seenUrls,overlapAnchorSeen,unresolved:audit.unresolved,corroborated:audit.corroborated,excluded:audit.excluded,quarantined}};
}
module.exports={collectEagles};
