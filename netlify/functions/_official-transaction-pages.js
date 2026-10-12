'use strict';
const {createHash}=require('node:crypto');
const {parseTransactions}=require('./_injury-transactions');
const fingerprint=html=>createHash('sha256').update((/<table\b[^>]*>[\s\S]*?<\/table>/i.exec(html)?.[0]||html).replace(/\s+/g,' ')).digest('hex');
function nextPage(html,source){
 const tag=[...html.matchAll(/<a\b[^>]*>/gi)].map(m=>m[0]).find(t=>/class=["'][^"']*nfl-o-table-pagination__next\b/i.test(t));
 const href=tag&&/href=["']([^"']+)["']/i.exec(tag)?.[1];
 if(!href)return null;
 const url=new URL(href.replace(/&amp;/g,'&'),'https://www.nfl.com');
 if(url.origin!=='https://www.nfl.com'||url.pathname!==new URL(source.url).pathname||!url.searchParams.get('after'))throw Error('Official pagination link contract changed.');
 // Serialize the supplied cursor safely; use the same official path.
 url.searchParams.sort();return url.href;
}
async function collectPages(source,{fetchImpl=fetch,maxPages=12,maxAttempts=3,onRequest=()=>{}}={}){
 const records=[],seenUrls=new Set(),seenContent=new Set();let url=source.url;
 for(let page=0;url&&page<maxPages;page++){
  let accepted=null;
  for(let attempt=0;attempt<maxAttempts;attempt++){
   onRequest();
   const response=await fetchImpl(url,{signal:AbortSignal.timeout(12000),...(attempt?{headers:{'Cache-Control':'no-cache'}}:{})});
   if(!response.ok)throw Error(`Official transactions HTTP ${response.status}`);
   const html=await response.text(),digest=fingerprint(html),next=nextPage(html,source);
   const parsed=parseTransactions(html,source.year,source.month,source.category,url);
   if(seenContent.has(digest)||seenUrls.has(url)||next&&(next===url||seenUrls.has(next))){
    if(attempt+1===maxAttempts){const error=Error('Official transaction pagination loop; previous cache preserved.');error.partialRecords=records;throw error;}
    continue;
   }
   accepted={digest,next,parsed};break;
  }
  seenUrls.add(url);seenContent.add(accepted.digest);records.push(...accepted.parsed);url=accepted.next;
 }
 if(url){const error=Error('Official transaction pagination limit reached; previous cache preserved.');error.partialRecords=records;throw error;}
 return records;
}
module.exports={collectPages,nextPage};
