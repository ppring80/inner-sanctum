'use strict';
// Source adapter, not an analyst: only literal, complete official statements
// below become structured evidence. No model output, headline or chart inference.
const {createHash}=require('node:crypto');
const clubs=require('./_official-club-sources.json');
const {canonicalNameKey}=require('../../player-identity');
const {resolveCurrentNFLWeek}=require('./_current-nfl-week');
const STORE='sage-role-events',VERSION=1,MAX_EVENTS=1000,DAY=86400000;
const hash=s=>createHash('sha256').update(s).digest('hex');
const plain=s=>String(s||'').replace(/\s+/g,' ').trim();
const key=p=>[canonicalNameKey(p.player||p.longName),p.position||p.pos,p.team].join('|');
const reporters=require('./_role-report-sources.json');
const {claimsForArticle}=require('./_role-report-claims');
function reportSource(value){
 try{
  const u=new URL(value);
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)return null;
  const club=clubs.find(c=>[c.origin,...c.aliases||[]].includes(u.origin));
  if((club||u.hostname==='www.nfl.com')&&/^\/news\/[a-z0-9-]+$/.test(u.pathname))return {team:club?.team||null,authority:'TEAM_ANNOUNCEMENT',label:club?.club||'NFL.com'};
  const reporter=reporters.find(r=>r.host===u.hostname&&u.pathname.startsWith(r.pathPrefix)&&/^[a-z0-9-]+$/.test(u.pathname.slice(r.pathPrefix.length)));
  return reporter?{team:reporter.team,authority:'VERIFIED_REPORTER',reporters:reporter.reporters,label:u.hostname}:null;
 }catch{return null;}
}
function articleEvidence(html,url){
 const source=reportSource(url);if(!source)return null;
 const articles=[];
 for(const [,body]of String(html).matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
  let root;try{root=JSON.parse(body);}catch{continue;}
  if(!root||typeof root!=='object')continue;
  for(const node of Array.isArray(root)?root:root['@graph']||[root]){
   if(!node||typeof node!=='object')continue;
   const types=Array.isArray(node['@type'])?node['@type']:[node['@type']];
   if(types.includes('NewsArticle')||types.includes('Article'))articles.push(node);
  }
 }
 if(articles.length!==1)return null;
 const a=articles[0],identity=a.url||a.mainEntityOfPage?.['@id']||a.mainEntityOfPage;
 const published=Date.parse(a.datePublished),modified=a.dateModified?Date.parse(a.dateModified):published;
 if(identity!==url||typeof a.articleBody!=='string'||!a.articleBody.trim()||a.articleBody.length>200000||/[<>]/.test(a.articleBody)||!Number.isFinite(published)||!Number.isFinite(modified)||modified<published)return null;
 const authors=(Array.isArray(a.author)?a.author:[a.author]).map(v=>typeof v==='string'?v:v?.name).filter(Boolean);
 if(source.reporters&&!authors.some(n=>source.reporters.includes(n)))return null;
 const body=plain(a.articleBody);
 return {sourceUrl:url,publishedAt:a.datePublished,modifiedAt:a.dateModified||null,versionAt:new Date(modified).toISOString(),headline:plain(a.headline),body,bodyHash:hash(body),sourceTeam:source.team,authority:source.authority,reporter:source.reporters?authors.find(n=>source.reporters.includes(n)):null,sourceLabel:source.label};
}
const POSITIONS={QB:'quarterback',RB:'running back',WR:'wide receiver',TE:'tight end'};
function extractReports(items,playerCache,{season,now=Date.now()}={}){
 const result={reports:[],articles:[],rejected:[],unresolved:[],coverage:'PARTIAL_VERIFIED_ROLE_REPORTS',identityFresh:false};
 const age=now-Date.parse(playerCache?.updatedAt);
 result.identityFresh=Number.isFinite(age)&&age>=0&&age<8*3600000;
 const players=Object.values(playerCache?.players||{}).filter(p=>POSITIONS[p?.pos]&&p.longName&&clubs.some(c=>c.team===p.team)&&String(p.isFreeAgent).toLowerCase()!=='true');
 for(const item of items||[]){
  const a=item?._roleArticle;
  if(!a){result.rejected.push({sourceUrl:item?.link||null,reason:'NO_VERIFIED_ARTICLE_BODY'});continue;}
  const source=reportSource(a.sourceUrl),published=Date.parse(a.publishedAt),version=Date.parse(a.versionAt||a.publishedAt),body=plain(a.body);
  if(!source||a.sourceUrl!==item.link||a.publishedAt!==item.publishedAt||!body||hash(body)!==a.bodyHash||!Number.isFinite(published)||!Number.isFinite(version)||version<published||a.modifiedAt&&Date.parse(a.modifiedAt)!==version||version>now||published>now||new Date(published).getUTCFullYear()!==Number(season)||source.reporters&&!source.reporters.includes(a.reporter)){
   result.rejected.push({sourceUrl:a.sourceUrl,reason:'SOURCE_DATE_OR_BODY_UNVERIFIED'});continue;
  }
  // A valid changed body can withdraw previous evidence even when the original
  // article is now old. It cannot create or renew a current assertion.
  result.articles.push({...a,body});
  if(now-published>7*DAY){result.rejected.push({sourceUrl:a.sourceUrl,reason:'SOURCE_PUBLICATION_STALE'});continue;}
  if(!result.identityFresh){result.rejected.push({sourceUrl:a.sourceUrl,reason:'PLAYER_IDENTITY_STALE_OR_MISSING'});continue;}
  const reportWeek=resolveCurrentNFLWeek(new Date(version),season);
  const futureRole=c=>/\bnext week\b/i.test(c.sourceQuote)||[...c.sourceQuote.matchAll(/\bWeek\s+(\d{1,2})\b/gi)].some(m=>Number(m[1])>reportWeek);
  const extracted=claimsForArticle({...a,sourceTeam:source.team,body},players,{season});
  result.unresolved.push(...extracted.unresolved.map(c=>({...c,reason:futureRole(c)?'ROLE_WEEK_NOT_CURRENT_AT_SOURCE_VERSION':c.reason,sourceUrl:a.sourceUrl,publishedAt:a.publishedAt,effectiveAt:a.modifiedAt?a.versionAt:a.publishedAt,dateBasis:'PUBLISHED',effectiveAtBasis:'REPORT_VERSION_BOUND',actualEffectiveAt:null,sourceBodyHash:a.bodyHash,sourceLabel:a.sourceLabel||source.label,authority:source.authority,reporter:a.reporter||undefined,verifiedAt:new Date(now).toISOString(),verified:true,season:Number(season),week:resolveCurrentNFLWeek(new Date(version),season),appliesFromWeek:resolveCurrentNFLWeek(new Date(version),season)})));
  for(const claim of extracted.claims){
   if(futureRole(claim)||[...claim.sourceQuote.matchAll(/\bWeek\s+(\d{1,2})\b/gi)].some(m=>Number(m[1])!==reportWeek)){
    result.unresolved.push({...claim,sourceUrl:a.sourceUrl,publishedAt:a.publishedAt,reason:'ROLE_WEEK_NOT_CURRENT_AT_SOURCE_VERSION'});continue;
   }
   const id='official-role-'+hash([a.sourceUrl,a.publishedAt,key(claim),claim.kind,claim.sourceQuote].join('|')).slice(0,32);
   // This is a conservative reporting bound, NOT the actual change/game date.
   // Edited articles never admit games before the observed source version.
   const effectiveAt=a.modifiedAt?a.versionAt:a.publishedAt;
   result.reports.push({id,...claim,season:Number(season),week:resolveCurrentNFLWeek(new Date(version),season),appliesFromWeek:resolveCurrentNFLWeek(new Date(version),season),
    authority:source.authority,reporter:a.reporter||undefined,sourceLabel:a.sourceLabel||source.label,sourceUrl:a.sourceUrl,publishedAt:a.publishedAt,modifiedAt:a.modifiedAt||null,
    effectiveAt,dateBasis:'PUBLISHED',effectiveAtBasis:'REPORT_VERSION_BOUND',actualEffectiveAt:null,verifiedAt:new Date(now).toISOString(),verified:true,fresh:true,statement:claim.sourceQuote,sourceBodyHash:a.bodyHash,ingestion:'verified-role-v2'});
  }
  if(!extracted.claims.length)result.rejected.push({sourceUrl:a.sourceUrl,reason:extracted.unresolved.length?'ROLE_ASSERTION_REQUIRES_REVIEW':'NO_UNAMBIGUOUS_DATED_ROLE_STATEMENT'});
 }
 return result;
}
function mergeHistory(previous,extracted,{season,now=Date.now(),seeds=[]}={}){
 if(previous&&(previous.version!==VERSION||Number(previous.season)!==Number(season)||!Array.isArray(previous.events)))throw Error('Role history contract mismatch; previous evidence preserved.');
 const events=structuredClone(previous?.events||[]),checkedAt=new Date(now).toISOString();
 for(const seed of seeds.filter(e=>Number(e.season)===Number(season))){
  const i=events.findIndex(e=>e.id===seed.id);
  if(i<0)events.push(structuredClone(seed));
  else if(Date.parse(seed.verifiedAt)>Date.parse(events[i].verifiedAt))events[i]=structuredClone(seed);
 }
 for(const event of events){
  const article=extracted.articles.find(a=>a.sourceUrl===event.sourceUrl);
  if(['official-literal-v1','verified-role-v2'].includes(event.ingestion)&&extracted.identityFresh&&article&&article.bodyHash!==event.sourceBodyHash&&!extracted.reports.some(r=>r.sourceUrl===event.sourceUrl&&r.sourceQuote===event.sourceQuote&&r.kind===event.kind))event.withdrawnAt=event.withdrawnAt||checkedAt;
  const confirmation=event.currentRoleConfirmation;
  const current=confirmation&&extracted.articles.find(a=>a.sourceUrl===confirmation.sourceUrl);
  if(extracted.identityFresh&&current&&current.bodyHash!==confirmation.sourceBodyHash&&!extracted.reports.some(r=>r.sourceUrl===confirmation.sourceUrl&&r.sourceQuote===confirmation.sourceQuote&&r.kind==='CONFIRMATION'))event.withdrawnAt=event.withdrawnAt||checkedAt;
 }
 for(const report of [...extracted.reports].sort((a,b)=>Date.parse(a.publishedAt)-Date.parse(b.publishedAt)||a.id.localeCompare(b.id))){
  if(report.kind!=='CONFIRMATION'){
   // Re-reading a dated announcement never renews its verification clock.
   if(!events.some(e=>e.id===report.id))events.push(structuredClone(report));
   continue;
  }
  const prior=events.filter(e=>key(e)===key(report)&&Date.parse(e.effectiveAt)<=Date.parse(report.publishedAt)).sort((a,b)=>Date.parse(b.effectiveAt)-Date.parse(a.effectiveAt));
  const latest=prior[0];
  // A confirmation cannot invent a change date or revive an old gain after a
  // loss/conflict. Only a newer dated source can corroborate an existing gain.
  if(!latest||latest.kind!=='ROLE_GAIN'||latest.explicitRole!=='STARTER'||latest.withdrawnAt||prior.some(e=>e.effectiveAt===latest.effectiveAt&&(e.kind!==latest.kind||e.explicitRole!==latest.explicitRole)))continue;
  const lastSource=latest.currentRoleConfirmation?.publishedAt||latest.publishedAt;
  if(Date.parse(report.publishedAt)<=Date.parse(lastSource))continue;
  latest.verifiedAt=report.verifiedAt;
  latest.currentRoleConfirmation={sourceUrl:report.sourceUrl,publishedAt:report.publishedAt,verifiedAt:report.verifiedAt,sourceQuote:report.sourceQuote,sourceBodyHash:report.sourceBodyHash};
 }
 if(events.length>MAX_EVENTS)throw Error('Role history capacity reached; previous evidence preserved.');
 // Resolved/withdrawn review items remain auditable but stop creating current
 // uncertainty when this source is re-read and the assertion is no longer there.
 const priorUnresolved=structuredClone(previous?.unresolved||[]);
 for(const item of priorUnresolved){
  const article=extracted.articles.find(a=>a.sourceUrl===item.sourceUrl);
  if(extracted.identityFresh&&article&&!extracted.unresolved?.some(c=>c.sourceUrl===item.sourceUrl&&key(c)===key(item)&&c.sourceQuote===item.sourceQuote))item.resolvedAt=item.resolvedAt||checkedAt;
 }
 const unresolved=[...priorUnresolved,...(extracted.unresolved||[])].filter((v,i,all)=>all.findIndex(x=>x.sourceUrl===v.sourceUrl&&x.player===v.player&&x.sourceQuote===v.sourceQuote&&(x.resolvedAt||null)===(v.resolvedAt||null))===i).slice(-200);
 return {version:VERSION,season:Number(season),checkedAt,events,unresolved,...(previous?.dedicatedCollection?{dedicatedCollection:previous.dedicatedCollection}:{}),collection:{coverage:extracted.coverage,identityFresh:extracted.identityFresh,articles:extracted.articles.length,reports:extracted.reports.length,unresolved:extracted.unresolved?.length||0,rejected:extracted.rejected}};
}
async function ingestRoleReports({store,items,playerCache,season,now=Date.now(),seeds=require('./_verified-role-events.json'),collection=null}){
 const extracted=extractReports(items,playerCache,{season,now}),historyKey='season:'+season;
 // Separate CAS history: neither an AI summary failure nor a concurrent
 // refresh may erase verified evidence. Bounded retries; no provider calls.
 for(let attempt=0;attempt<3;attempt++){
  const previous=await store.getWithMetadata(historyKey,{type:'json'});
  const next=mergeHistory(previous?.data,extracted,{season,now,seeds});
  if(collection)next.dedicatedCollection={...collection,checkedAt:new Date(now).toISOString(),coverage:extracted.coverage};
  const write=await store.setJSON(historyKey,next,previous?.etag?{onlyIfMatch:previous.etag}:{onlyIfNew:true});
  if(write.modified)return {cached:true,events:next.events.length,...next.collection};
 }
 throw Error('Role history write contention; previous evidence preserved.');
}
function roleHistoryStories(history,season,week,now=Date.now()){
 if(history?.version!==VERSION||Number(history.season)!==Number(season)||!Array.isArray(history.events))return [];
 // A verified current report whose role assertion cannot be resolved must
 // reach the existing REASSESS path, rather than silently protect an incumbent.
 const pending=(history.unresolved||[]).filter(e=>!e.resolvedAt&&e.verified===true&&e.effectiveAt&&e.reason!=='ROLE_WEEK_NOT_CURRENT_AT_SOURCE_VERSION').map(e=>({...e,id:'role-review-'+hash([e.sourceUrl,key(e),e.sourceQuote].join('|')).slice(0,32),kind:'ROLE_REASSESSMENT',explicitRole:'UNRESOLVED',statement:'Unresolved role report: '+e.sourceQuote.slice(0,376),fresh:true}));
 return [...history.events,...pending].filter(e=>e.kind!=='CONFIRMATION'&&Number(e.appliesFromWeek||e.week)<=Number(week)&&Date.parse(e.publishedAt)<=now&&Date.parse(e.effectiveAt)<=now&&Date.parse(e.verifiedAt)<=now)
  .map(e=>({id:e.id,editorial:true,player:e.player,position:e.position,team:e.team,sourceLabel:e.sourceLabel,sourceUrl:e.sourceUrl,publishedAt:e.publishedAt,verifiedAt:e.verifiedAt,
   roleReport:{...e,type:'TEAM_REPORTED_ROLE_CHANGE',fresh:!e.withdrawnAt&&now-Date.parse(e.verifiedAt)<7*DAY}}));
}
function mergeRoleStories(...groups){
 const stories=new Map();
 for(const s of groups.flat()){
  const id=s.id||[s.player,s.sourceUrl,s.roleReport?.effectiveAt].join('|');
  const prior=stories.get(id);
  if(!prior||Date.parse(s.verifiedAt)>Date.parse(prior.verifiedAt))stories.set(id,s);
 }
 return [...stories.values()];
}
async function readRoleHistory(getStore,season){
 try{return await getStore({name:STORE}).get('season:'+season,{type:'json'});}catch{return null;}
}
module.exports={reportSource,STORE,VERSION,MAX_EVENTS,articleEvidence,extractReports,mergeHistory,ingestRoleReports,roleHistoryStories,mergeRoleStories,readRoleHistory};
