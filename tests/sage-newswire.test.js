'use strict';
const assert = require('assert');
const Module = require('module');
let cache = null;
const load = Module._load;
Module._load = function(name, parent, isMain) {
  if (name === '@netlify/blobs') return {connectLambda(){},getStore(){return {get:async()=>cache}}};
  return load.call(this,name,parent,isMain);
};
const newswire = require('../netlify/functions/sage-newswire');
const {normalizeStories} = require('../netlify/functions/refresh-sage-newswire');
Module._load = load;
async function main() {
  const stories=normalizeStories([
    {title:'Test Player: Limited practice',link:'https://www.nfl.com/news/report',pubDate:'2026-09-30T10:00:00Z'},
    {title:'Duplicate',link:'https://www.nfl.com/news/report'},
    {title:'Unsafe',link:'javascript:alert(1)'},
    {title:'Other Player: Team update',link:'https://www.espn.com/nfl/story/report'}
  ],{one:{longName:'Test Player',team:'SEA',pos:'WR'}});
  assert.equal(stories.length,2);assert.equal(stories[0].player,'Test Player');
  assert.equal(stories[0].position,'WR');assert.equal(stories[1].publishedAt,null,'do not fabricate publication times');
  assert.equal(stories[0].headline,'Test Player: Limited practice');
  assert.equal(stories[0].status,'Source report','headlines are not official availability verdicts');
  cache={updatedAt:new Date().toISOString(),stories};
  assert.equal((await newswire.handler({httpMethod:'GET'})).statusCode,200);
  cache.updatedAt=new Date(Date.now()-25*60*60*1000).toISOString();
  const stale=await newswire.handler({httpMethod:'GET'});
  assert.equal(stale.statusCode,503);assert.deepEqual(JSON.parse(stale.body).stories,[]);
  cache=null;assert.equal((await newswire.handler({httpMethod:'GET'})).statusCode,503);
  assert.equal((await newswire.handler({httpMethod:'POST'})).statusCode,405);
  console.log('Newswire cache freshness, source links, identity, and publication-time checks passed.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
