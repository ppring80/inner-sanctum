'use strict';
const assert=require('assert'),{currentNewswire}=require('../netlify/functions/_newswire-availability');
const now=Date.parse('2026-10-19T03:10:00Z');
const cache={availabilityMode:'tank01-full-player-list-v1',updatedAt:new Date(now).toISOString(),teamsSucceeded:32,teamsFailed:0,players:{one:{longName:'Test Back',pos:'RB',team:'SEA',injury:{designation:'IR',description:'Placed on injured reserve.',injDate:'20261018'}},two:{longName:'Healthy Player',pos:'WR',team:'SEA',injury:{designation:''}},three:{longName:'PUP Example',pos:'TE',team:'CLE',injury:{designation:'Out'}}}};
const old={id:'old',player:'Test Back',team:'SEA',status:'OUT',headline:'Ruled out for Thursday',publishedAt:'2026-10-14T22:00:00Z',sageImpact:'Bench before Thursday kickoff.'};
const report={id:'new',player:'Test Back',team:'SEA',status:'Injury watch',headline:'Official reserve update',publishedAt:'2026-10-18T22:00:00Z',sageImpact:'Specific role analysis',sourceUrl:'https://www.nfl.com/news/update'};
let out=currentNewswire([old,report],cache,now);
assert(out.availability.fresh);assert.equal(out.stories.length,2);assert(!out.stories.some(s=>s.id==='old'));
const back=out.stories.find(s=>s.player==='Test Back');assert.equal(back.status,'IR');assert.equal(back.report.sourceUrl,report.sourceUrl);assert.equal(back.report.sageImpact,report.sageImpact);assert.equal(back.publishedAt,cache.updatedAt);assert.equal(back.dateLabel,'Status checked');
assert.equal(out.stories.find(s=>s.player==='PUP Example').status,'Out','Never infer PUP from Out');
assert(!out.stories.some(s=>s.player==='Healthy Player'),'Empty designation never implies cleared');
for(const bad of [null,{...cache,updatedAt:new Date(now-9*3600000).toISOString()},{...cache,updatedAt:new Date(now+1).toISOString()},{...cache,teamsSucceeded:31}]){out=currentNewswire([old,report],bad,now);assert(!out.availability.fresh);assert(!out.stories.some(s=>s.observedAt));assert(!out.stories.some(s=>s.id==='old'));}
const free=structuredClone(cache);free.players.one.isFreeAgent='True';assert(!currentNewswire([],free,now).stories.some(s=>s.player==='Test Back'));
console.log('Newswire current availability: PASS');
