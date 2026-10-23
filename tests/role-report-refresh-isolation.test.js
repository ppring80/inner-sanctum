'use strict';
const assert=require('node:assert/strict'),Module=require('node:module');
const roles=require('../netlify/functions/_role-event-ingestion');
const {articleMetadata}=require('../netlify/functions/_newswire-sources');
const NativeDate=Date,stamp='2026-10-22T18:00:00Z';
global.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[stamp]));}static now(){return NativeDate.parse(stamp);}};
const doc={'@type':'NewsArticle',url:'https://www.nfl.com/news/role-isolation',headline:'Team announces starter',datePublished:'2026-10-22T17:00:00Z',articleBody:'The Seahawks have named Example Receiver their starting wide receiver.'};
const source=articleMetadata('<script type="application/ld+json">'+JSON.stringify(doc)+'</script>',doc.url);
let history=null,news=null,mode='summary-fails',providerCalls=0,authorized=true;
const roleStore={getWithMetadata:async()=>history?{data:history,etag:'one'}:null,setJSON:async(k,v)=>{if(mode==='history-fails')throw Error('Storage unavailable');history=v;return {modified:true};}};
const load=Module._load;
Module._load=function(name,parent,isMain){
 if(name==='@netlify/blobs')return {connectLambda(){},getStore({name}){if(name===roles.STORE)return roleStore;return {get:async()=>name==='player-data'?{updatedAt:stamp,players:{one:{longName:'Example Receiver',pos:'WR',team:'SEA'}}}:news,setJSON:async(k,v)=>{news=v;}};}};
 if(name==='./_tank01-refresh-guard'&&parent?.filename.endsWith('/refresh-sage-newswire.js'))return {requireTank01RefreshAuthorization:()=>authorized?null:{statusCode:401,body:'denied'}};
 if(name==='./_newswire-sources'&&parent?.filename.endsWith('/refresh-sage-newswire.js'))return {...load.call(this,name,parent,isMain),collectSources:async()=>({items:[{...source,title:'Example Receiver workload report',description:doc.articleBody}],errors:[]})};
 if(name==='./_newswire-analysis'&&parent?.filename.endsWith('/refresh-sage-newswire.js'))return {analyzeStories:async candidates=>{providerCalls++;if(mode==='summary-fails')throw Error('Controlled summary failure');return candidates.map(({_sourceContext,...s})=>({...s,summary:'Source-grounded fixture summary',sageImpact:'Existing inference fixture preserved.'}));}};
 return load.call(this,name,parent,isMain);
};
const handler=require('../netlify/functions/refresh-sage-newswire').handler;
Module._load=load;
(async()=>{
 assert.equal((await handler({})).statusCode,502);assert(history.events.some(e=>e.player==='Example Receiver'),'Summary failure cannot erase source evidence');assert.equal(providerCalls,1,'One existing summary attempt; no paid role call or retry');assert.equal(news,null,'Failed summary preserves previous news cache');
 mode='history-fails';assert.equal((await handler({})).statusCode,200);assert.equal(news.collection.roleIngestion.cached,false);assert.equal(news.collection.roleIngestion.error,'Storage unavailable');assert(news.stories.some(s=>s.player==='Example Receiver'),'Role storage failure cannot block news');
 const before=providerCalls;authorized=false;assert.equal((await handler({})).statusCode,401);assert.equal(providerCalls,before,'Unauthorized requests cannot reach either ingestion or provider');
 console.log('PASS: role/news failure isolation, unchanged summary call count and authorization.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{global.Date=NativeDate;});
