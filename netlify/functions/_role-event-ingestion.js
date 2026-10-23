'use strict';
// Source adapter, not an analyst: only literal, complete official statements
// below become structured evidence. No model output, headline or chart inference.
const {createHash}=require('node:crypto');
const clubs=require('./_official-club-sources.json');
const {canonicalNameKey}=require('../../player-identity');
const {resolveCurrentNFLWeek}=require('./_current-nfl-week');
const STORE='sage-role-events',VERSION=1,MAX_EVENTS=1000,DAY=86400000;
const hash=s=>createHash('sha256').update(s).digest('hex');
const escape=s=>String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const plain=s=>String(s||'').replace(/\s+/g,' ').trim();
const key=p=>[canonicalNameKey(p.player||p.longName),p.position||p.pos,p.team].join('|');
function officialReportUrl(value){
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&u.hostname==='www.nfl.com'&&/^\/news\/[a-z0-9-]+$/.test(u.pathname)?u.href:null;}catch{return null;}
}
function articleEvidence(html,url){
 if(!officialReportUrl(url))return null;
 const articles=[];
 for(const [,body]of String(html).matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
  let root;try{root=JSON.parse(body);}catch{continue;}
  if(!root||typeof root!=='object')continue;
  for(const node of Array.isArray(root)?root:root['@graph']||[root]){
   if(!node||typeof node!=='object')continue;
   const types=Array.isArray(node['@type'])?node['@type']:[node['@type']];
   if(types.includes('NewsArticle'))articles.push(node);
  }
 }
 if(articles.length!==1)return null;
 const a=articles[0],identity=a.url||a.mainEntityOfPage?.['@id']||a.mainEntityOfPage;
 if(a.dateModified&&a.dateModified!==a.datePublished)return null;
 if(identity!==url||typeof a.articleBody!=='string'||!a.articleBody.trim()||a.articleBody.length>200000||/[<>]/.test(a.articleBody)||!Number.isFinite(Date.parse(a.datePublished)))return null;
 const body=plain(a.articleBody);
 return {sourceUrl:url,publishedAt:a.datePublished,headline:plain(a.headline),body,bodyHash:hash(body)};
}
const POSITIONS={QB:'quarterback',RB:'running back',WR:'wide receiver',TE:'tight end'};
function statementKind(sentence,p,club){
 const team='(?:'+[club.club,club.club.split(' ').at(-1)].map(escape).join('|')+')';
 const name=escape(p.longName),position=escape(POSITIONS[p.pos]),prefix='(?:The |the )?'+team;
 // Full sentence matching deliberately rejects forecasts, quotations, historic
 // clauses, conditions, negation, co-starters and inferred injury replacements.
 const patterns={
  ROLE_GAIN:[prefix+' (?:has|have) named '+name+' (?:its|their) (?:new )?starting '+position+'[.!]',prefix+' (?:has|have) announced '+name+' as (?:its|their) (?:new )?starting '+position+'[.!]',name+' has been named (?:the )?'+team+"(?:['’]s|['’]) (?:new )?starting "+position+'[.!]'],
  ROLE_LOSS:[prefix+' (?:has|have) moved '+name+' to (?:its|their|the) bench[.!]',name+' is no longer (?:the )?'+team+"(?:['’]s|['’]) starting "+position+'[.!]'],
  CONFIRMATION:[name+' remains (?:the )?'+team+"(?:['’]s|['’]) starting "+position+'[.!]']
 };
 return Object.entries(patterns).find(([,list])=>list.some(pattern=>new RegExp('^'+pattern+'$').test(sentence)))?.[0]||null;
}
function extractReports(items,playerCache,{season,now=Date.now()}={}){
 const result={reports:[],articles:[],rejected:[],coverage:'PARTIAL_OFFICIAL_REPORTS',identityFresh:false};
 const age=now-Date.parse(playerCache?.updatedAt);
 result.identityFresh=Number.isFinite(age)&&age>=0&&age<8*3600000;
 const players=Object.values(playerCache?.players||{}).filter(p=>POSITIONS[p?.pos]&&p.longName&&clubs.some(c=>c.team===p.team)&&String(p.isFreeAgent).toLowerCase()!=='true');
 for(const item of items||[]){
  const a=item?._roleArticle;
  if(!a){result.rejected.push({sourceUrl:item?.link||null,reason:'NO_VERIFIED_ARTICLE_BODY'});continue;}
  const published=Date.parse(a.publishedAt),body=plain(a.body);
  if(!officialReportUrl(a.sourceUrl)||a.sourceUrl!==item.link||a.publishedAt!==item.publishedAt||!body||hash(body)!==a.bodyHash||!Number.isFinite(published)||published>now||now-published>7*DAY||new Date(published).getUTCFullYear()!==Number(season)){
   result.rejected.push({sourceUrl:a.sourceUrl,reason:'SOURCE_DATE_OR_BODY_UNVERIFIED'});continue;
  }
  result.articles.push({...a,body});
  if(!result.identityFresh){result.rejected.push({sourceUrl:a.sourceUrl,reason:'PLAYER_IDENTITY_STALE_OR_MISSING'});continue;}
  // Only the article's declarative lead, never a quote embedded later in
  // analysis. Uncertain/corrected headlines or negation require editorial review.
  if(/\b(?:not|never|denied|denies|rumou?r|false|speculation|could|might|may|expected|unconfirmed)\b/i.test(a.headline)){result.rejected.push({sourceUrl:a.sourceUrl,reason:'SOURCE_CONTEXT_REQUIRES_REVIEW'});continue;}
  const lead=body.split(/(?<=[.!?])\s+(?=[A-Z])/)[0];
  let accepted=0;
  for(const sentence of [lead]){
   if(sentence.length>400)continue;
   const matches=players.map(p=>({p,kind:statementKind(sentence,p,clubs.find(c=>c.team===p.team))})).filter(x=>x.kind);
   // Name collisions remain ambiguous even if one row happens to fit a club.
   if(matches.length!==1||players.filter(p=>canonicalNameKey(p.longName)===canonicalNameKey(matches[0].p.longName)).length!==1)continue;
   const {p,kind}=matches[0];
   const id='official-role-'+hash([a.sourceUrl,a.publishedAt,key(p),kind,sentence].join('|')).slice(0,32);
   result.reports.push({id,player:p.longName,position:p.pos,team:p.team,season:Number(season),week:resolveCurrentNFLWeek(new Date(published),season),appliesFromWeek:resolveCurrentNFLWeek(new Date(published),season),kind,
    explicitRole:kind==='ROLE_LOSS'?'BACKUP':'STARTER',authority:'TEAM_ANNOUNCEMENT',sourceLabel:'NFL.com · explicit team role report',sourceUrl:a.sourceUrl,publishedAt:a.publishedAt,
    effectiveAt:a.publishedAt,dateBasis:'PUBLISHED',verifiedAt:new Date(now).toISOString(),verified:true,fresh:true,statement:sentence,sourceQuote:sentence,sourceBodyHash:a.bodyHash,ingestion:'official-literal-v1'});
   accepted++;
  }
  if(!accepted)result.rejected.push({sourceUrl:a.sourceUrl,reason:'NO_UNAMBIGUOUS_DATED_ROLE_STATEMENT'});
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
  if(event.ingestion==='official-literal-v1'&&extracted.identityFresh&&article&&article.bodyHash!==event.sourceBodyHash&&!extracted.reports.some(r=>r.sourceUrl===event.sourceUrl&&r.sourceQuote===event.sourceQuote&&r.kind===event.kind))event.withdrawnAt=event.withdrawnAt||checkedAt;
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
 return {version:VERSION,season:Number(season),checkedAt,events,collection:{coverage:extracted.coverage,identityFresh:extracted.identityFresh,articles:extracted.articles.length,reports:extracted.reports.length,rejected:extracted.rejected}};
}
async function ingestRoleReports({store,items,playerCache,season,now=Date.now(),seeds=require('./_verified-role-events.json')}){
 const extracted=extractReports(items,playerCache,{season,now}),historyKey='season:'+season;
 // Separate CAS history: neither an AI summary failure nor a concurrent
 // refresh may erase verified evidence. Bounded retries; no provider calls.
 for(let attempt=0;attempt<3;attempt++){
  const previous=await store.getWithMetadata(historyKey,{type:'json'});
  const next=mergeHistory(previous?.data,extracted,{season,now,seeds});
  const write=await store.setJSON(historyKey,next,previous?.etag?{onlyIfMatch:previous.etag}:{onlyIfNew:true});
  if(write.modified)return {cached:true,events:next.events.length,...next.collection};
 }
 throw Error('Role history write contention; previous evidence preserved.');
}
function roleHistoryStories(history,season,week,now=Date.now()){
 if(history?.version!==VERSION||Number(history.season)!==Number(season)||!Array.isArray(history.events))return [];
 return history.events.filter(e=>e.kind!=='CONFIRMATION'&&Number(e.appliesFromWeek||e.week)<=Number(week)&&Date.parse(e.publishedAt)<=now&&Date.parse(e.effectiveAt)<=now&&Date.parse(e.verifiedAt)<=now)
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
module.exports={STORE,VERSION,MAX_EVENTS,articleEvidence,extractReports,mergeHistory,ingestRoleReports,roleHistoryStories,mergeRoleStories,readRoleHistory};
