'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {updateEntries}=require('../netlify/functions/_dallas-update-entries');
const html=fs.readFileSync(path.join(__dirname,'fixtures/dallas-october-update-entries.html'),'utf8');
const opts={sourceUrl:'https://www.dallascowboys.com/news/updates-october-2026',season:2026,observedAt:'2026-10-13T02:50:00Z'};
const r=updateEntries(html,opts);assert.equal(r.complete,true);
const move=r.entries.find(e=>e.sourceText.includes('waiving RB Emari Demercado'));
assert.equal(move.reportedAt,'2026-10-08');assert.equal(move.customerEligible,false);assert.equal(move.status,undefined);
assert.ok(r.entries.some(e=>e.sourceText.includes('21-day practice window')));
assert.equal(updateEntries(html.replace('<h2>Oct. 8</h2>','<h2>BAD</h2>'),opts).complete,false);
assert.equal(updateEntries(html,{...opts,observedAt:'2026-10-01T00:00:00Z'}).complete,false);
console.log('PASS: real Dallas updates use embedded dates, not publication date; no activation from practice windows or malformed dates.');

assert.equal(updateEntries(html.replace('<h2>Oct. 8</h2>','<h2>October 8</h2>'),opts).complete,true);
