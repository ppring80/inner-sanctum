'use strict';
const assert=require('node:assert/strict');
const {articleEvidence,extractReports,mergeHistory,roleHistoryStories}=require('../netlify/functions/_role-event-ingestion');
const {claimsForArticle}=require('../netlify/functions/_role-report-claims');
const {sources,discover,collectRoleSources,MAX_ARTICLES}=require('../netlify/functions/_role-report-collection');
const source={url:'https://www.azcardinals.com/news/',team:'ARI'};
const brooks='https://www.azcardinals.com/news/mcbride-always-and-brooks-more-often-with-rams-snaps';
const players=[{longName:'Jalen Brooks',pos:'WR',team:'ARI'},{longName:'Example Runner',pos:'RB',team:'ARI'},{longName:'Example End',pos:'TE',team:'ARI'}];
const parse=(body,sourceTeam='ARI')=>claimsForArticle({body,headline:'Game observations',sourceTeam},players,{season:2026});
// Real official-club excerpt, published 2026-10-19T17:22:12.996Z.
// Parser fixture only: not a replay of historical player-cache contents.
const actual='Jalen Brooks, now that Marvin Harrison Jr. is gone, is now going to play more often.';
assert(discover('<a href="'+brooks+'">McBride always, and Brooks more often</a>',source).some(x=>x.url===brooks));
for(const body of [actual,'Jalen Brooks got the bulk of the snaps that once went to Harrison, getting 39 total after playing 13 total the first four games.','Example Runner received more carries this week.','Example End played fewer snaps on Sunday.','Example End could get more snaps next week.']){
 const result=parse(body);assert.equal(result.claims.length,0,'Participation cannot establish starter status');assert.equal(result.unresolved.length,1,body);assert.equal(result.unresolved[0].reason,'PARTICIPATION_CHANGE_REQUIRES_REVIEW');assert.equal(result.unresolved[0].sourceQuote,body);
}
for(const body of ['Example Runner had 20 carries.','Example End scored more touchdowns.','Jalen Brooks played more snaps last season.','Jalen Brooks played more snaps in 2024.'])assert.equal(parse(body).unresolved.length,0,body);
assert.equal(parse(actual,'SEA').unresolved.length,0,'Opponent identity cannot acquire role evidence');
assert.equal(parse('Jalen Brooks is the starting wide receiver and will play more snaps.').claims[0].kind,'ROLE_GAIN','Explicit starter grammar remains authoritative');
assert.equal(parse('Jalen Brooks is the starting wide receiver and will play more snaps.').unresolved.length,0);
const now=Date.parse('2026-10-23T06:00:00Z');
const doc={'@type':'NewsArticle',url:brooks,headline:'McBride always, and Brooks more often',datePublished:'2026-10-19T17:22:12.996Z',articleBody:actual};
const article=articleEvidence('<script type="application/ld+json">'+JSON.stringify(doc)+'</script>',brooks);
const extract=(a,time=now)=>extractReports([{link:brooks,publishedAt:a.publishedAt,_roleArticle:a}],{updatedAt:new Date(time).toISOString(),players:{one:players[0]}},{season:2026,now:time});
const evidence=extract(article);assert.equal(evidence.reports.length,0);assert.equal(evidence.unresolved.length,1);
const history=mergeHistory(null,evidence,{season:2026,now});
const stories=roleHistoryStories(history,2026,7,now);assert.equal(stories.length,1);assert.equal(stories[0].roleReport.kind,'ROLE_REASSESSMENT');assert.equal(stories[0].roleReport.actualEffectiveAt,null);assert.equal(stories[0].roleReport.firstAffectedGameID,undefined);
assert.equal(require('../netlify/functions/_super-sage-role-establishment').establishRole({event:stories[0].roleReport,name:'Jalen Brooks',position:'WR',team:'ARI',season:2026,week:7,opportunity:{provenance:{decisionCutoff:new Date(now).toISOString()}}}).reason,'beneficiary_role_not_confirmed');
assert.equal(extract(article,now+7*86400000).unresolved.length,0,'Stale publication cannot renew participation evidence');
const withdrawn={...article,body:'This report was withdrawn.',bodyHash:require('node:crypto').createHash('sha256').update('This report was withdrawn.').digest('hex')};
assert.equal(roleHistoryStories(mergeHistory(history,extract(withdrawn),{season:2026,now}),2026,7,now).length,0,'Corrected source clears participation uncertainty');
(async()=>{
 const indexes=[source,{url:'https://www.giants.com/news/',team:'NYG'}];
 const fetch=async target=>({ok:true,text:async()=>target.endsWith('/news/')?Array.from({length:40},(_,i)=>'<a href="'+target+'ordinary-report-'+i+'">Game observations</a>').join(''):''});
 const now=Date.parse('2026-10-23T06:00:00Z');
 const first=await collectRoleSources(fetch,{indexes,now});
 const second=await collectRoleSources(fetch,{indexes,now:now+6*3600000,previousCollection:first.collection});
 assert.equal(first.collection.articlesAttempted,MAX_ARTICLES);assert.equal(second.collection.articlesAttempted,MAX_ARTICLES);
 const a=Object.keys(first.collection.progress.attempts),b=Object.keys(second.collection.progress.attempts);
 assert.equal(a.length,32);assert.equal(b.length,64,'Failed metadata attempts also advance discovery');
 assert.equal(second.collection.omittedByArticleLimit,48);assert.equal(second.collection.coverage,'PARTIAL_VERIFIED_ROLE_REPORTS');
 const publisherFetch=async target=>({ok:true,text:async()=>sources.some(s=>s.url===target)?'<a href="'+new URL('/news/ordinary-report',target).href+'">Game observations</a>':''});
 const publishers=await collectRoleSources(publisherFetch,{now});
 const nextPublishers=await collectRoleSources(publisherFetch,{now:now+6*3600000,previousCollection:publishers.collection});
 // Registered reporter path has a different shape; exercise the last club.
 const lastClub=new URL('/news/ordinary-report',sources.filter(s=>s.url.endsWith('/news/')).at(-1).url).href;
 assert(!publishers.collection.progress.attempts[lastClub]);assert(nextPublishers.collection.progress.attempts[lastClub],'Previously omitted publisher gets a slot');
 assert.equal(nextPublishers.collection.progress.publisherCursor,30,'Publisher start rotates across 34 indexes');
 const attempts=Object.fromEntries(Array.from({length:2200},(_,i)=>['https://www.azcardinals.com/news/old-'+i,new Date(now-3600000).toISOString()]));
 const bounded=await collectRoleSources(fetch,{indexes:[source],now,previousCollection:{progress:{attempts}}});
 assert.equal(Object.keys(bounded.collection.progress.attempts).length,2048);
 console.log('PASS: broad publisher discovery, persistent bounded progress, RB/WR/TE participation review and historical/performance/opponent controls.');
})().catch(error=>{console.error(error);process.exitCode=1;});
