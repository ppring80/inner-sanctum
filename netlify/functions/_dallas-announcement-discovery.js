'use strict';
// Dallas's own lazyloadmore module increments Skip by Count and adds " async".
// Read-only URL/card contract; this module cannot set cache freshness.
const {officialUrl}=require('./_official-club-transactions');
const INDEX='https://www.dallascowboys.com/news/all-news/';
const attr=(tag,name)=>new RegExp('\\b'+name+'="([^"]*)"','i').exec(tag)?.[1];
function indexModule(html){
 const modules=[];
 for(const [,body] of html.matchAll(/<script\b[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi)){
  try{const d=JSON.parse(body);if(d.Name==='EditorialList'&&d.Module?.SectionTitle==='All News')modules.push(d);}catch{}
 }
 if(modules.length!==1)throw Error('Dallas index module missing or ambiguous.');
 const d=modules[0],m=d.Module;
 if(m.Category!=='news-all-news'||m.Type!=='stories'||m.Skip!==0||m.Count!==20||m.View!=='Text + Thumb')throw Error('Dallas index module contract changed.');
 return d;
}
function pageUrl(module,page){
 if(!Number.isInteger(page)||page<2||page>5)throw Error('Dallas page outside verified bounds.');
 const d=JSON.parse(JSON.stringify(module));
 if(d.Name!=='EditorialList'||d.Module?.Category!=='news-all-news'||d.Module.Count!==20||d.Module.Skip!==0)throw Error('Dallas request contract changed.');
 d.Module.Skip=(page-1)*20;d.Module.View='Text + Thumb async';
 const u=new URL('/api/lazy/load',INDEX);u.searchParams.set('json',JSON.stringify(d));return officialUrl(u.href,'DAL');
}
function pageCards(html,{seen=[]}={}){
 const urls=[];
 for(const [,tag] of html.matchAll(/(<a\b[^>]*>)/gi)){
  if(attr(tag,'data-link_type')!=='All News')continue;
  const url=officialUrl(new URL(attr(tag,'href'),INDEX).href,'DAL');
  if(!new URL(url).pathname.startsWith('/news/'))throw Error('Dallas article outside news path.');
  urls.push(url);
 }
 if(urls.length!==20||new Set(urls).size!==20||urls.some(u=>seen.includes(u)))throw Error('Dallas page incomplete or repeated.');
 return urls;
}
module.exports={INDEX,indexModule,pageUrl,pageCards};
