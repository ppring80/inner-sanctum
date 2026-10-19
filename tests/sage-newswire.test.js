'use strict';
const assert=require('assert'),Module=require('module');let cache=null;const load=Module._load;
Module._load=function(name,parent,isMain){if(name==='@netlify/blobs')return {connectLambda(){},getStore(){return {get:async()=>cache}}};return load.call(this,name,parent,isMain);};
const newswire=require('../netlify/functions/sage-newswire');const {normalizeStories,mergeStories}=require('../netlify/functions/refresh-sage-newswire');const {editorialStories}=require('../netlify/functions/_newswire-editorial');const {parseFeed,articleMetadata}=require('../netlify/functions/_newswire-sources');Module._load=load;
const realNow=Date.now;
// Freeze the editorial fixture window; reports correctly expire after seven days.
Date.now=()=>Date.parse('2026-10-08T18:00:00Z');
(async()=>{
 const now=Date.parse('2026-09-30T06:00:00Z'),players={one:{longName:'Test Player',team:'SEA',pos:'WR'}};
 const stories=normalizeStories([
 {title:'Test Player ruled out with ankle injury',link:'https://www.nfl.com/news/test-player-injury',publishedAt:'2026-09-29T10:00:00Z',sourceLabel:'NFL.com'},
 {title:'Depth Charts',link:'https://www.espn.com/nfl/depthcharts',publishedAt:'2026-09-29T10:00:00Z'},
 {title:'Test Player injury',link:'https://evil.example/story',publishedAt:'2026-09-29T10:00:00Z'},
 {title:'Test Player returns to practice',link:'https://www.espn.com/nfl/story/1'},
 {title:'Test Player ruled out with ankle injury',link:'https://www.nfl.com/news/test-player-injury',publishedAt:'2026-09-29T10:00:00Z'}],players,now);
 assert.equal(stories.length,1);assert.equal(stories[0].player,'Test Player');assert(stories[0].sageImpact.includes('Test Player'));assert(!stories[0].sageImpact.includes('This headline alone'));
 const editorial=editorialStories(now);assert(editorial.some(s=>s.sourceUrl.startsWith('https://x.com/AdamSchefter/status/')));assert(editorial.some(s=>s.sourceUrl.startsWith('https://www.nfl.com/')));assert(new Set(editorial.map(s=>s.sageImpact)).size===editorial.length);assert(editorial.every(s=>s.publishedAt&&s.summary&&s.sageImpact));
 assert.equal(mergeStories(editorial,[{...editorial[0],sageImpact:'Generic'}]).find(s=>s.id===editorial[0].id).sageImpact,editorial[0].sageImpact,'automatic reports cannot replace editorial interpretation');
 assert.equal(parseFeed('<rss><item><title><![CDATA[Test &amp; report]]></title><link>https://www.espn.com/nfl/story/1</link><pubDate>Tue, 29 Sep 2026 10:00:00 GMT</pubDate></item></rss>','ESPN')[0].title,'Test & report');
 assert.equal(articleMetadata('<script type="application/ld+json">{"@type":"NewsArticle","headline":"Test Player ruled out","datePublished":"2026-09-29T10:00:00Z"}</script>','https://www.nfl.com/news/test').publishedAt,'2026-09-29T10:00:00Z');
 cache={mode:'editorial-with-sources',updatedAt:new Date(Date.now()).toISOString(),stories};assert.equal((await newswire.handler({httpMethod:'GET'})).statusCode,200);
 assert(!editorialStories(Date.parse('2026-10-09T22:00:00Z')).some(s=>s.id==='zay-flowers-20261002'),'seven-day report expiry remains enforced');
 const live=JSON.parse((await newswire.handler({httpMethod:'GET'})).body);
 assert(!live.availability.fresh,'news reports alone cannot certify current player availability');
 assert(live.stories.every(s=>Date.now()-Date.parse(s.publishedAt)<72*3600000),'expired editorial advice is not current news');
 assert(editorialStories().some(s=>s.player==='Justin Jefferson'),'dated editorial evidence remains available to the reporting layer');
 assert.equal(mergeStories([{player:'One',sourceUrl:'same',headline:'One out'},{player:'Two',sourceUrl:'same',headline:'Two out'}],[]).length,2);
 const current=editorialStories(Date.parse('2026-10-10T21:30:00Z'));
 for(const [player,status] of [['Saquon Barkley','OUT'],['Lamar Jackson','OUT'],['Jayden Daniels','Starting'],['Justin Jefferson','Questionable'],['DJ Moore','Questionable'],['Josh Palmer','OUT'],['Tank Bigsby','IR'],['Dallas Goedert','Cleared']]){
  const cards=current.filter(s=>s.player===player);assert.equal(cards.length,1,player+' has one current editorial card');assert.equal(cards[0].status,status);
 }
 const merged=mergeStories(current,[{id:'old-dj',player:'DJ Moore',publishedAt:'2026-10-05T01:51:00Z',sourceUrl:'old',headline:'Old injury watch'},{id:'unrelated',player:'Other Player',publishedAt:'2026-10-05T01:51:00Z',sourceUrl:'other',headline:'Other report'}]);
 assert(!merged.some(s=>s.id==='old-dj'),'superseded cached report removed');assert(merged.some(s=>s.id==='unrelated'),'unrelated reporting retained');
 const rolloverNow=Date.parse('2026-10-15T01:28:00Z');
 const week6=editorialStories(rolloverNow);assert(week6.length>=20);assert(!week6.some(s=>/week5-/.test(s.id)),'last-week game guidance expires at Tuesday rollover');
 assert.equal(week6.find(s=>s.player==='Lamar Jackson').status,'Practice watch','last-week OUT does not become this-week OUT');
 assert.equal(week6.find(s=>s.player==='Zach Charbonnet').status,'OUT');
 assert.equal(week6.find(s=>s.player==='Jaxon Smith-Njigba').status,'Cleared');
 const frozenNow=Date.now;Date.now=()=>rolloverNow;
 const cachedWeek5=current.find(s=>s.player==='Jayden Daniels');
 assert(!mergeStories(week6,[cachedWeek5]).some(s=>s.id===cachedWeek5.id),'expired cached editorial cannot reappear');
 Date.now=frozenNow;
 cache={mode:'source-headlines',updatedAt:new Date(Date.now()).toISOString(),stories:[{headline:'Depth Charts'}]};const fallback=JSON.parse((await newswire.handler({httpMethod:'GET'})).body);assert(!fallback.stories.some(s=>s.headline==='Depth Charts'),'bad legacy feed cannot displace editorial');assert(fallback.automaticRefreshPending);
 assert.equal((await newswire.handler({httpMethod:'POST'})).statusCode,405);console.log('Newswire source coverage, editorial preservation, relevance, publication dates and specific analysis passed.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{Date.now=realNow;});
