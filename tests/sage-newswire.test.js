'use strict';
const assert=require('assert'),Module=require('module');let cache=null;const load=Module._load;
Module._load=function(name,parent,isMain){if(name==='@netlify/blobs')return {connectLambda(){},getStore(){return {get:async()=>cache}}};return load.call(this,name,parent,isMain);};
const newswire=require('../netlify/functions/sage-newswire');const {normalizeStories,mergeStories}=require('../netlify/functions/refresh-sage-newswire');const {editorialStories}=require('../netlify/functions/_newswire-editorial');const {parseFeed,articleMetadata}=require('../netlify/functions/_newswire-sources');Module._load=load;
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
 assert.equal(mergeStories(editorial,[{...editorial[0],sageImpact:'Generic'}])[0].sageImpact,editorial[0].sageImpact,'automatic reports cannot replace editorial interpretation');
 assert.equal(parseFeed('<rss><item><title><![CDATA[Test &amp; report]]></title><link>https://www.espn.com/nfl/story/1</link><pubDate>Tue, 29 Sep 2026 10:00:00 GMT</pubDate></item></rss>','ESPN')[0].title,'Test & report');
 assert.equal(articleMetadata('<script type="application/ld+json">{"@type":"NewsArticle","headline":"Test Player ruled out","datePublished":"2026-09-29T10:00:00Z"}</script>','https://www.nfl.com/news/test').publishedAt,'2026-09-29T10:00:00Z');
 cache={mode:'editorial-with-sources',updatedAt:new Date().toISOString(),stories};assert.equal((await newswire.handler({httpMethod:'GET'})).statusCode,200);
 cache={mode:'source-headlines',updatedAt:new Date().toISOString(),stories:[{headline:'Depth Charts'}]};const fallback=JSON.parse((await newswire.handler({httpMethod:'GET'})).body);assert(!fallback.stories.some(s=>s.headline==='Depth Charts'),'bad legacy feed cannot displace editorial');assert(fallback.automaticRefreshPending);
 assert.equal((await newswire.handler({httpMethod:'POST'})).statusCode,405);console.log('Newswire source coverage, editorial preservation, relevance, publication dates and specific analysis passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
