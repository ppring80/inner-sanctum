'use strict';
// Separate, bounded discovery. Fantasy guides cannot consume role article slots.
// No model, Tank01 call, redirect following, authentication or paywall bypass.
const clubs=require('./_official-club-sources.json');
const reporters=require('./_role-report-sources.json');
const {reportSource,articleEvidence}=require('./_role-event-ingestion');
const MAX_ARTICLES=32,MAX_BYTES=4*1024*1024,CONCURRENCY=4;
const sources=[{url:'https://www.nfl.com/news/series/around-the-nfl-news',team:null},...clubs.map(c=>({url:c.origin+'/news/',team:c.team})),...reporters.map(r=>({url:'https://'+r.host+r.pathPrefix,team:r.team}))];
const fantasy=/fantasy|start-em|sit-em|waiver|rankings|bold-prediction|betting|odds|mock-draft/i;
const role=/start|bench|quarterback|backfield|committee|workload|role|reps|depth-chart/i;
function discover(html,index){
 const seen=new Set(),candidates=[];
 for(const match of String(html).matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
  let u;try{u=new URL(match[1].replace(/&amp;/g,'&'),index.url);}catch{continue;}
  // Only this verified publisher; no query-bearing links or unrelated services.
  if(u.origin!==new URL(index.url).origin||!reportSource(u.href)||seen.has(u.href))continue;
  const label=match[2].replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
  if(fantasy.test(u.pathname+' '+label)||!role.test(u.pathname+' '+label))continue;
  seen.add(u.href);candidates.push({url:u.href,team:index.team,label:label.slice(0,200)});
 }
 return candidates;
}
async function mapLimit(values,fn){
 const results=new Array(values.length);let cursor=0;
 await Promise.all(Array.from({length:Math.min(CONCURRENCY,values.length)},async()=>{while(cursor<values.length){const i=cursor++;results[i]=await fn(values[i]);}}));return results;
}
async function read(url,fetchImpl){
 const response=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(10000),headers:{Accept:'text/html'}});
 if(!response.ok)throw Error('HTTP '+response.status);
 if(response.url&&response.url!==url)throw Error('Unexpected response URL');
 if(Number(response.headers?.get('content-length'))>MAX_BYTES)throw Error('Source exceeds size limit');
 // Bound streaming reads as well as Content-Length; publishers can omit it.
 if(response.body?.getReader){
  const reader=response.body.getReader(),chunks=[];let length=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>MAX_BYTES)throw Error('Source exceeds size limit');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
  return Buffer.concat(chunks).toString('utf8');
 }
 const body=await response.text();if(Buffer.byteLength(body)>MAX_BYTES)throw Error('Source exceeds size limit');return body;
}
async function collectRoleSources(fetchImpl=fetch,{indexes=sources}={}){
 const errors=[],discovery=[],items=[];
 const lists=await mapLimit(indexes,async index=>{
  try{const candidates=discover(await read(index.url,fetchImpl),index);discovery.push({sourceUrl:index.url,team:index.team,candidates:candidates.length});return candidates;}
  catch(error){errors.push({sourceUrl:index.url,stage:'DISCOVERY',error:error.message});return [];}
 });
 // Round-robin publishers. A busy league feed cannot crowd out team reporting.
 const selected=[],seen=new Set();let offset=0;
 while(selected.length<MAX_ARTICLES&&lists.some(list=>list.length>offset)){
  for(const list of lists){const candidate=list[offset];if(candidate&&!seen.has(candidate.url)&&selected.length<MAX_ARTICLES){seen.add(candidate.url);selected.push(candidate);}}offset++;
 }
 const all=new Set(lists.flat().map(c=>c.url));
 await mapLimit(selected,async candidate=>{
  try{
   const html=await read(candidate.url,fetchImpl),article=articleEvidence(html,candidate.url);
   if(!article)throw Error('VERIFIED_ARTICLE_METADATA_UNAVAILABLE');
   items.push({link:candidate.url,title:article.headline,publishedAt:article.publishedAt,_roleArticle:article});
  }catch(error){errors.push({sourceUrl:candidate.url,stage:'ARTICLE',error:error.message});}
 });
 return {items,collection:{indexesAttempted:indexes.length,indexesSucceeded:discovery.length,articlesAttempted:selected.length,articlesVerified:items.length,omittedByArticleLimit:Math.max(0,all.size-selected.length),requestLimit:indexes.length+MAX_ARTICLES,discovery,errors,coverage:'PARTIAL_VERIFIED_ROLE_REPORTS'}};
}
module.exports={sources,MAX_ARTICLES,MAX_BYTES,discover,collectRoleSources};
