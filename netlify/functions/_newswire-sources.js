'use strict';
const FEEDS=[{name:'ESPN',url:'https://www.espn.com/espn/rss/nfl/news'},{name:'CBS Sports',url:'https://www.cbssports.com/rss/headlines/nfl/'}];
const NFL_DISCOVERY='https://www.nfl.com/rss/rsslanding?searchString=news';
function text(value){return String(value||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]*>/g,' ').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&#x([a-f0-9]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&amp;/g,'&').replace(/&#39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();}
function parseFeed(xml,sourceLabel){return Array.from(xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)).map(([,item])=>{const field=k=>text(new RegExp(`<${k}\\b[^>]*>([\\s\\S]*?)<\\/${k}>`,'i').exec(item)?.[1]);return {title:field('title'),link:field('link'),description:field('description'),publishedAt:field('pubDate'),sourceLabel};});}
function articleMetadata(html,url){for(const [,raw] of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{const root=JSON.parse(raw);for(const node of (Array.isArray(root)?root:root['@graph']||[root]))if(node['@type']==='NewsArticle')return {title:text(node.headline),description:text(node.description||node.articleBody),link:url,publishedAt:node.datePublished,sourceLabel:'NFL.com'};}catch(_){}}return null;}
async function collectSources(fetcher=fetch){const errors=[],items=[];const get=async url=>{const r=await fetcher(url,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error(`HTTP ${r.status}`);return r.text();};
 await Promise.all(FEEDS.map(async source=>{try{items.push(...parseFeed(await get(source.url),source.name));}catch(e){errors.push({source:source.name,error:e.message});}}));
 try{const html=await get(NFL_DISCOVERY);const links=[...new Set(Array.from(html.matchAll(/(?:https:\/\/www\.nfl\.com)?\/news\/[a-z0-9-]+/g),m=>'https://www.nfl.com'+m[0].replace('https://www.nfl.com','')))].filter(u=>/injur|practice|ruled|return|release|sign|running-back|quarterback|wide-receiver|tight-end|workload|fumbl/i.test(u)).slice(0,6);
 await Promise.all(links.map(async url=>{try{const item=articleMetadata(await get(url),url);if(item)items.push(item);}catch(e){errors.push({source:url,error:e.message});}}));
 }catch(e){errors.push({source:'NFL.com',error:e.message});}
 return {items,errors};
}
module.exports={FEEDS,NFL_DISCOVERY,text,parseFeed,articleMetadata,collectSources};
