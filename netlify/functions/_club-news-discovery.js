'use strict';
const {createHash}=require('node:crypto');
const {cardsFromProfile}=require('./_club-news-cards');
const {officialUrl}=require('./_official-club-transactions');
function publication(html){
 const items=[];
 // The official Browns pages encode '+' in the HTML type attribute. Script
 // contents remain raw JSON; decode only the observed attribute spelling.
 for(const [,body]of String(html).matchAll(/<script\b[^>]*type=["']application\/ld(?:\+|&#x0*2b;|&#0*43;)json["'][^>]*>([\s\S]*?)<\/script>/gi)){
  let data;try{data=JSON.parse(body);}catch{continue;}
  for(const item of Array.isArray(data)?data:data['@graph']||[data]){
   const types=Array.isArray(item['@type'])?item['@type']:[item['@type']];
   if(types.some(type=>['NewsArticle','Article'].includes(type)))items.push(item);
  }
 }
 if(items.length!==1)throw Error('Official article metadata missing or ambiguous.');
 const item=items[0],publishedAt=item.datePublished,modifiedAt=item.dateModified||null;
 if(!publishedAt||!Number.isFinite(Date.parse(publishedAt))||modifiedAt&&!Number.isFinite(Date.parse(modifiedAt)))throw Error('Official article dates invalid.');
 // A valid edit timestamp may precede publication. Keep both exactly as
 // supplied, disclose their ordering, and never invent an effective event date.
 return {publishedAt,modifiedAt,headline:item.headline||'',dateOrderWarning:modifiedAt&&Date.parse(modifiedAt)<Date.parse(publishedAt)?'MODIFIED_BEFORE_PUBLICATION':null};
}
async function discoverNews({profile,read,since,asOf,previousSeen=[],parallel=1,onArticle=()=>{}}){
 officialUrl(profile.sourceUrl,profile.team);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(since)||!Number.isFinite(Date.parse(since))||!Number.isFinite(Date.parse(asOf))||since>asOf.slice(0,10)||!Number.isInteger(parallel)||parallel<1||parallel>4)throw Error('Invalid bounded discovery contract.');
 const indexHtml=await read(profile.sourceUrl),cards=cardsFromProfile(indexHtml,profile),articles=new Array(cards.length),errors=[];
 let next=0;
 async function worker(){
  while(next<cards.length){
   const position=next++,card=cards[position];
   try{
    const html=await read(card.url),meta=publication(html);
    if([meta.publishedAt,meta.modifiedAt].filter(Boolean).some(date=>Date.parse(date)>Date.parse(asOf)))throw Error('Official article after observation cutoff.');
    if([meta.publishedAt,meta.modifiedAt].filter(Boolean).some(date=>date.slice(0,10)>=since))await onArticle({html,card,...meta});
    articles[position]={...card,...meta,sha256:createHash('sha256').update(html).digest('hex')};
   }catch(error){errors.push({url:card.url,position:position+1,error:error.message});}
  }
 }
 await Promise.all(Array.from({length:parallel},worker));
 const verified=articles.filter(Boolean),allDatesVerified=verified.length===cards.length&&errors.length===0;
 const chronological=allDatesVerified&&verified.every((a,i)=>!i||Date.parse(a.publishedAt)<=Date.parse(verified[i-1].publishedAt));
 const boundaryReached=chronological&&verified.at(-1).publishedAt.slice(0,10)<since;
 const seenUrls=verified.map(article=>article.url),overlapAnchorSeen=previousSeen.some(url=>seenUrls.includes(url));
 return {team:profile.team,indexUrl:profile.sourceUrl,indexHash:createHash('sha256').update(indexHtml).digest('hex'),since,asOf,listedCards:cards.length,articles:verified,errors,allDatesVerified,chronological,boundaryReached,overlapAnchorSeen,
  targets:verified.filter(article=>[article.publishedAt,article.modifiedAt].filter(Boolean).some(date=>date.slice(0,10)>=since)),
  discoveryPassed:allDatesVerified&&chronological&&boundaryReached&&(!previousSeen.length||overlapAnchorSeen),coveragePassed:false,productionEnabled:false};
}
module.exports={publication,discoverNews};
