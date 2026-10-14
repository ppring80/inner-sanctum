'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{analyzePage}=require('../scripts/audit-official-club-page-formats');
const opts={team:'PHI',kind:'news',url:'https://www.philadelphiaeagles.com/news/',status:200,responseUrl:'https://www.philadelphiaeagles.com/news/',observedAt:'2026-10-14T00:00:00Z'};
const r=analyzePage({...opts,html:fs.readFileSync(__dirname+'/fixtures/eagles-news-card-contract.html','utf8')});assert.equal(r.storyModules[0].selection,'latest-stories');assert.equal(r.coveragePassed,false);
assert.equal(analyzePage({...opts,status:404,html:'Missing'}).error,'SOURCE_HTTP_404');
const links=analyzePage({...opts,html:'<a href="https://example.com/news/all" title="All News">News</a><a href="/news/all" title="All News">News</a>'});assert.equal(links.candidateIndexes.length,1);
assert.throws(()=>analyzePage({...opts,url:'https://example.com/',html:''}));
console.log('PASS: source-format inventory retains contracts and errors, excludes foreign candidates and never qualifies coverage.');
