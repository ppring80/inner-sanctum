'use strict';
// Read-only qualification collector. It never writes Blobs or marks production fresh.
const {createHash}=require('node:crypto');
const {clubs,officialUrl,parseTable,parseStatement}=require('./_official-club-transactions');
const strip=s=>String(s).replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim();
const attribute=(tag,name)=>new RegExp('\\b'+name+'=["\']([^"\']*)["\']','i').exec(tag)?.[1];
function discover(html,url,team){
 const links=[];
 for(const [,tag,body]of html.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/gi)){
  const href=attribute(tag,'href');if(!href||!/^\/?news\//.test(href)&&!href.startsWith('https://'))continue;
  let target;try{target=officialUrl(new URL(href,url).href,team);}catch{continue;}
  if(!new URL(target).pathname.startsWith('/news/')||!attribute(tag,'data-id'))continue;
  const title=attribute(tag,'title')||attribute(tag,'data-link_name')||strip(body);
  links.push({url:target,title,relevant:/roster|transaction|injured.reserve|activat|reinstat|waiv|release|trade/i.test(title+' '+target)});
 }
 return [...new Map(links.map(l=>[l.url,l])).values()];
}
function article(html,url,team,observedAt,identities){
 // Only the article body and its own publication date, never related stories/footer.
 let publishedAt=null;
 for(const [,json]of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
  try{const data=JSON.parse(json),items=Array.isArray(data)?data:data['@graph']||[data];
   const own=items.find(x=>['NewsArticle','Article'].includes(x['@type'])&&x.datePublished);if(own)publishedAt=own.datePublished;
  }catch{/* Malformed structured publication metadata is not trusted. */}
 }
 const textBlock=/<div\b[^>]*class=["'][^"']*\bnfl-c-body-part--text\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(html)?.[1];
 const body=textBlock&&/<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(textBlock)?.[1];
 if(!publishedAt||!Number.isFinite(Date.parse(publishedAt)))throw Error('Article publication date contract unverified.');
 if(!body)throw Error('Article body contract unverified.');
 if(Date.parse(publishedAt)>Date.parse(observedAt))throw Error('Article published after observation cutoff.');
 return {...parseStatement({text:body,reportedAt:publishedAt.slice(0,10),team,sourceUrl:url,observedAt,identities}),publishedAt};
}
function validateCoverage(reports,requiredTeams=clubs.map(c=>c.team)){
 const gaps=[];
 for(const team of requiredTeams){
  const entries=reports.filter(r=>r.team===team);if(entries.length!==1){gaps.push({team,reason:'MISSING_OR_DUPLICATE_TEAM'});continue;}
  const r=entries[0];
  for(const condition of ['discoveryContractVerified','boundaryReached','overlapAnchorSeen','identityComplete','subjectsComplete','stateReconciled'])if(r[condition]!==true)gaps.push({team,reason:condition});
  if(r.errors?.length)gaps.push({team,reason:'SOURCE_ERROR'});
  if(r.unresolved?.length)gaps.push({team,reason:'UNRESOLVED_EVENTS'});
 }
 return {complete:gaps.length===0&&reports.length===requiredTeams.length,coveredTeams:requiredTeams.filter(t=>!gaps.some(g=>g.team===t)),gaps};
}
async function collectClub(club,{fetchImpl=fetch,identities=[],observedAt=new Date().toISOString(),since,previousSeen=[],newsUrl,maxArticles=10,maxRequests=14,minIntervalMs=1000,onRequest=()=>{},discoveryContractVerified=false}={}){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(since||''))throw Error('Explicit collection boundary required.');
 const report={team:club.team,evidence:[],unresolved:[],errors:[],requests:0,discoveryContractVerified,boundaryReached:false,overlapAnchorSeen:false,identityComplete:false,subjectsComplete:false,stateReconciled:false,seenUrls:[]};
 let lastStart=0;
 async function read(url){
  officialUrl(url,club.team);if(report.requests>=maxRequests)throw Error('Club request limit reached.');
  const delay=Math.max(0,minIntervalMs-(Date.now()-lastStart));if(delay)await new Promise(r=>setTimeout(r,delay));lastStart=Date.now();report.requests++;onRequest(url);
  const response=await fetchImpl(url,{signal:AbortSignal.timeout(12000),redirect:'manual'});
  if(!response.ok)throw Error('Official club HTTP '+response.status);
  const html=await response.text();return {html,hash:createHash('sha256').update(html).digest('hex')};
 }
 try{
  const source=await read(club.transactionsUrl);report.tableHash=source.hash;
  const table=parseTable(source.html,{season:Number(since.slice(0,4)),team:club.team,sourceUrl:club.transactionsUrl,observedAt,identities});
  report.evidence.push(...table.evidence.filter(e=>e.reportedAt>=since));report.unresolved.push(...table.unresolved);
 }catch(e){report.errors.push({source:club.transactionsUrl,message:e.message});}
 const indexUrl=newsUrl||club.origin+'/news/';
 try{
  const index=await read(indexUrl),links=discover(index.html,indexUrl,club.team);report.indexHash=index.hash;report.discoveredArticles=links.length;
  report.seenUrls=links.map(l=>l.url);report.overlapAnchorSeen=previousSeen.some(u=>report.seenUrls.includes(u));
  if(!links.length)throw Error('Dated news discovery contract missing.');
  const targets=[...new Map([links[0],links.at(-1),...links.filter(l=>l.relevant)].map(l=>[l.url,l])).values()];
  if(targets.length>maxArticles)report.errors.push({source:indexUrl,message:'Article limit would omit discovered targets.'});
  for(const target of targets.slice(0,maxArticles)){
   try{const response=await read(target.url),parsed=article(response.html,target.url,club.team,observedAt,identities);
    if(parsed.publishedAt.slice(0,10)<=since&&target.url===links.at(-1).url)report.boundaryReached=true;
    if(parsed.publishedAt.slice(0,10)>=since){report.evidence.push(...parsed.evidence);report.unresolved.push(...parsed.unresolved);}
   }catch(e){report.errors.push({source:target.url,message:e.message});}
  }
 }catch(e){report.errors.push({source:indexUrl,message:e.message});}
 // No adapter has yet proven subject completeness or state reconciliation.
 report.coverage=validateCoverage([report],[club.team]);return report;
}
module.exports={discover,article,validateCoverage,collectClub};
