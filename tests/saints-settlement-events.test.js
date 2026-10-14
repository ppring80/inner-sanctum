'use strict';
const fs=require('fs'),assert=require('node:assert/strict');
const {settlementEvents}=require('../netlify/functions/_saints-settlement-events');
const html=fs.readFileSync(__dirname+'/fixtures/saints-dated-settlements.html','utf8');
const opts={season:2026,sourceUrl:'https://www.neworleanssaints.com/team/transactions/2026',observedAt:'2026-10-14T01:00:00Z'};
const r=settlementEvents(html,opts);assert.equal(r.events.length,5);assert.equal(r.unresolved.length,0);
assert.equal(r.events.find(e=>e.name==='Audric Estime').reportedAt,'2026-09-22');assert.equal(r.events.find(e=>e.name==='Devin Neal').reportedAt,'2026-09-03');assert.ok(!r.events.some(e=>e.name==='Scott Daly'));
assert.equal(settlementEvents(html.replace('RB <a','Unknown <a'),opts).unresolved.length,1);
assert.throws(()=>settlementEvents(html,{...opts,observedAt:'2026-08-01T00:00:00Z'}));
assert.throws(()=>settlementEvents(html.replace('href="https://www.neworleanssaints.com','href="https://example.com'),opts));
console.log('PASS: official settlement rows, complete subjects, unrelated action separation, dates and identity.');

const placement=settlementEvents(fs.readFileSync(__dirname+'/fixtures/saints-chandler-placement.html','utf8'),opts);assert.equal(placement.events.length,2);assert.equal(placement.events.find(e=>e.name==='Ty Chandler').reportedAt,'2026-08-25');assert.equal(placement.events[0].kind,'RESERVE_PLACEMENT');
