'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {collectSaints}=require('../netlify/functions/_club-availability-adapters');
const {indexCards}=require('../netlify/functions/_saints-announcement-discovery');
const club=require('../netlify/functions/_official-club-sources.json').find(c=>c.team==='NO');
const index=fs.readFileSync(path.join(__dirname,'fixtures/saints-headline-card-contract.html'),'utf8'),cards=indexCards(index);
const roster='<h4 class="nfl-o-roster__title"><span class="nfl-o-roster__title-status">Active</span></h4><table><tr><th>Player</th><th>Pos</th></tr><tr><td><a href="/team/players-roster/active-player/" title="Active Player">Active Player</a></td><td>RB</td></tr></table>';
const asOf='2026-10-13T01:00:00Z';
function reader(unsupported=false){let calls=0;return {get calls(){return calls;},read:async url=>{
 calls++;if(url.includes('/team/transactions/'))return fs.readFileSync(path.join(__dirname,'fixtures/saints-dated-settlements.html'),'utf8');if(url.endsWith('/team/players-roster/'))return roster;
 if(url.endsWith('/news/latest-headlines'))return index;
 const i=cards.findIndex(c=>c.url===url);assert.ok(i>=0);
 const publishedAt=new Date(Date.parse('2026-10-12T12:00:00Z')-i*6*3600000).toISOString();
 return `<script type="application/ld+json">${JSON.stringify({'@type':'NewsArticle',datePublished:publishedAt,author:'New Orleans Saints',description:'Game news'})}</script><div class="nfl-c-body-part--text"><p>${unsupported&&i===0?(typeof unsupported==='string'?unsupported:'The Saints placed an unnamed player on injured reserve.'):'Game observations.'}</p></div>`;
 }};}
(async()=>{
 const source=reader(),r=await collectSaints({club,read:source.read,previous:null,season:2026,asOf});
 assert.equal(source.calls,83);assert.equal(r.discoveryComplete,true);assert.equal(r.discovery.bootstrap,true);assert.equal(r.events.length,5);
 const blocked=reader(true),unknown=await collectSaints({club,read:blocked.read,previous:null,season:2026,asOf});
 assert.equal(unknown.discoveryComplete,false);assert.equal(unknown.discovery.unresolved[0].reason,'RESERVE_ACTION_OUTSIDE_QUALIFIED_ALERT_FORMAT');
 assert.match(unknown.discovery.unresolved[0].sourceText,/unnamed player/);
 for(const text of ['Devin Neal and Audric Estime both were released with injury settlements.', 'A player reverted to Reserve/Injured.']){
  const result=await collectSaints({club,read:reader(text).read,previous:null,season:2026,asOf});
  assert.equal(result.discoveryComplete,false);assert.equal(result.events.length,5);
  assert.equal(result.discovery.unresolved[0].sourceText,text);
 }
 const recap='Devin Neal and Audric Estime, who played meaningful snaps last season, both were released with injury settlements and both signed with the Vikings practice squad Wednesday.';
 const reconciled=await collectSaints({club,read:reader(recap).read,previous:null,season:2026,asOf});
 assert.equal(reconciled.discoveryComplete,true);assert.equal(reconciled.events.length,5);assert.equal(reconciled.discovery.corroborated.length,1);
 const named=await collectSaints({club,read:reader('Running back Travis Etienne Jr. was placed on injured reserve this week.').read,previous:null,season:2026,asOf});
 assert.match(named.discovery.unresolved[0].sourceText,/Travis Etienne Jr\. was placed/);
 const missingAnchor=await collectSaints({club,read:reader().read,previous:{asOf,discovery:{seenUrls:[]}},season:2026,asOf});
 assert.equal(missingAnchor.discoveryComplete,false);
 console.log('PASS: integrated Saints collector reads every card, enforces dates and overlap, blocks unsupported reserve actions and never invents events.');
})().catch(e=>{console.error(e);process.exitCode=1;});
