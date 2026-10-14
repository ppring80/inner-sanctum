'use strict';
// Chargers-specific read-only discovery. No player status or freshness authority.
const {createHash}=require('node:crypto');
const {officialUrl}=require('./_official-club-transactions');
const INDEX='https://www.chargers.com/news/all-news';
const attr=(tag,name)=>new RegExp('\\b'+name+'=["\']([^"\']*)["\']','i').exec(tag)?.[1];
function indexCards(html){
 const modules=[];
 for(const [,body]of html.matchAll(/<script\b[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi)){
  try{const d=JSON.parse(body);if(d.Name==='EditorialList'&&d.Module?.SectionTitle===null&&d.Module?.Selection===null)modules.push(d.Module);}catch{}
 }
 if(modules.length!==1||modules[0].Type!=='stories'||modules[0].Skip!==0)throw Error('Chargers headline module contract changed.');
 const count=modules[0].Count;if(!Number.isInteger(count)||count<1||count>80)throw Error('Chargers headline count outside verified bounds.');
 const cards=[];
 for(const [,tag]of html.matchAll(/(<a\b[^>]*>)/gi)){
  if(attr(tag,'data-link_type')!=='')continue;
  const position=/^(\d+):(\d+)$/.exec(attr(tag,'data-link_position')||'');
  if(!position||Number(position[2])!==count)throw Error('Chargers headline position contract changed.');
  const url=officialUrl(new URL(attr(tag,'href'),INDEX).href,'LAC');
  if(!new URL(url).pathname.startsWith('/news/'))throw Error('Unexpected Chargers article path.');
  cards.push({position:Number(position[1]),url,title:attr(tag,'title')||attr(tag,'data-link_name')||''});
 }
 if(cards.length!==count||new Set(cards.map(c=>c.url)).size!==count||cards.some((c,i)=>c.position!==i+1))throw Error('Chargers headline cards missing, duplicated or reordered.');
 return cards;
}
function publication(html){
 const items=[];
 for(const [,body]of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
  try{const d=JSON.parse(body);for(const x of Array.isArray(d)?d:d['@graph']||[d])if(['NewsArticle','Article'].includes(x['@type']))items.push(x);}catch{}
 }
 if(items.length!==1||!items[0].datePublished||!Number.isFinite(Date.parse(items[0].datePublished)))throw Error('Chargers article publication contract changed.');
 const item=items[0];return {publishedAt:item.datePublished,modifiedAt:item.dateModified||null,headline:item.headline||'',description:item.description||'',authorName:typeof item.author==='string'?item.author:item.author?.name||null};
}
async function discoverChargersNews({fetchImpl=fetch,since,observedAt=new Date().toISOString(),previousSeen=[],maxRequests=81,minIntervalMs=1000,deadlineMs=240000,onPage=()=>{},clock=()=>Date.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(since||'')||!Number.isFinite(Date.parse(observedAt))||since>observedAt.slice(0,10))throw Error('Invalid discovery window.');
 const started=clock();let requests=0,lastStart=null;
 const report={team:'LAC',indexUrl:INDEX,since,observedAt,requests:0,articles:[],targets:[],errors:[],complete:false};
 async function read(url){
  if(requests>=maxRequests||clock()-started>=deadlineMs)throw Error('Chargers discovery budget exhausted.');
  if(lastStart!==null){const wait=Math.max(0,minIntervalMs-(clock()-lastStart));if(wait)await sleep(wait);}
  if(clock()-started>=deadlineMs)throw Error('Chargers discovery deadline exceeded.');
  lastStart=clock();requests++;report.requests=requests;
  const r=await fetchImpl(officialUrl(url,'LAC'),{signal:AbortSignal.timeout(Math.max(1,Math.min(12000,Math.ceil(deadlineMs-(clock()-started))))),redirect:'manual'});
  if(!r.ok)throw Error('Chargers discovery HTTP '+r.status);
  const html=await r.text();if(clock()-started>=deadlineMs)throw Error('Chargers discovery deadline exceeded.');
  const hash=createHash('sha256').update(html).digest('hex');await onPage({url,html,hash});return {html,hash};
 }
 try{
  const index=await read(INDEX);report.indexHash=index.hash;
  const cards=indexCards(index.html);report.listedCards=cards.length;
  // Inspect every listed article. No title filter can silently omit a move.
  for(const card of cards){
   try{const response=await read(card.url),meta=publication(response.html);
    if(Date.parse(meta.publishedAt)>Date.parse(observedAt))throw Error('Chargers article after observation cutoff.');
    report.articles.push({...card,...meta,hash:response.hash});
   }catch(e){report.errors.push({url:card.url,error:e.message});if(/budget|deadline/.test(e.message))break;}
  }
  report.allDatesVerified=report.articles.length===cards.length&&report.errors.length===0;
  report.chronological=report.allDatesVerified&&report.articles.every((a,i)=>!i||Date.parse(a.publishedAt)<=Date.parse(report.articles[i-1].publishedAt));
  const oldest=report.articles.at(-1);report.oldestPublishedAt=oldest?.publishedAt||null;
  report.boundaryReached=report.allDatesVerified&&report.chronological&&oldest.publishedAt.slice(0,10)<since;
  report.overlapAnchorSeen=previousSeen.some(url=>report.articles.some(a=>a.url===url));
  // Retain every in-window article for extraction; labels do not prove relevance.
  report.targets=report.articles.filter(a=>a.publishedAt.slice(0,10)>=since);
  report.complete=report.allDatesVerified&&report.chronological&&report.boundaryReached;
 }catch(e){report.errors.push({url:INDEX,error:e.message});}
 return report;
}
module.exports={INDEX,indexCards,publication,discoverChargersNews};
