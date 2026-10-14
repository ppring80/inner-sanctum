'use strict';
// Shared parsing for an explicitly supplied observed contract. No network/freshness authority.
const {officialUrl}=require('./_official-club-transactions');
const attr=(tag,name)=>new RegExp('\\b'+name+'=(["\'])(.*?)\\1','i').exec(tag)?.[2];
function cardsFromProfile(html,{team,sourceUrl,linkType,count,moduleContract=null,featuredCount=0}){
 officialUrl(sourceUrl,team);
 if(typeof linkType!=='string'||!Number.isInteger(count)||count<1||count>80||!Number.isInteger(featuredCount)||featuredCount<0||featuredCount>10)throw Error('News profile outside bounded contract.');
 if(moduleContract){
  const modules=[];
  for(const [,body]of html.matchAll(/<script\b[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi)){
   try{const d=JSON.parse(body);if(d.Name==='EditorialList'&&d.Module&&Object.entries(moduleContract).every(([k,v])=>d.Module[k]===v))modules.push(d.Module);}catch{}
  }
  if(modules.length!==1||modules[0].Type!=='stories'||modules[0].Count!==count||modules[0].Skip!==featuredCount)throw Error('News module contract changed or ambiguous.');
 }
 const cards=[];
 for(const [,tag]of html.matchAll(/(<a\b[^>]*>)/gi)){
  if(attr(tag,'data-link_type')!==linkType)continue;
  const position=/^(\d+):(\d+)$/.exec(attr(tag,'data-link_position')||'');
  if(!position||Number(position[2])!==count)throw Error('News card position contract changed.');
  const href=attr(tag,'href');if(!href)throw Error('News card href missing.');
  const url=officialUrl(new URL(href.replace(/&amp;/g,'&'),sourceUrl).href,team);
  if(!new URL(url).pathname.startsWith('/news/'))throw Error('News card outside article path.');
  cards.push({position:Number(position[1]),url,title:attr(tag,'title')||attr(tag,'data-link_name')||''});
 }
 if(cards.length!==count||new Set(cards.map(c=>c.url)).size!==count||cards.some((c,i)=>c.position!==i+1))throw Error('News cards missing, duplicated or reordered.');
 const featured=[];
 if(featuredCount){
  const main=/<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1]||'';
  for(const [,tag]of main.matchAll(/(<a\b[^>]*>)/gi)){
   if(!/\bd3-o-media-object\b/.test(attr(tag,'class')||'')||attr(tag,'data-link_type'))continue;
   const href=attr(tag,'href');if(!href?.startsWith('/news/'))continue;
   featured.push({position:featured.length+1,url:officialUrl(new URL(href,sourceUrl).href,team),title:attr(tag,'aria-label')||''});
  }
  if(featured.length!==featuredCount)throw Error('Featured article prefix contract changed.');
 }
 const result=[...featured,...cards.map(c=>({...c,position:c.position+featuredCount}))];
 if(new Set(result.map(c=>c.url)).size!==result.length)throw Error('Featured/list article overlap.');
 return result;
}
module.exports={cardsFromProfile};
