'use strict';
const fs=require('fs'),assert=require('node:assert/strict');
const {extractChargersEvents}=require('../netlify/functions/_chargers-announcement-events');
const html=fs.readFileSync(__dirname+'/fixtures/chargers-activation-lead.html','utf8'),table=fs.readFileSync(__dirname+'/fixtures/chargers-october-dated-rows.html','utf8');
const options={sourceUrl:'https://www.chargers.com/news/activate-scott-matlock-branson-taylor-sign-theo-wease-active-roster-2026',observedAt:'2026-10-14T02:00:00Z',roster:require('./fixtures/chargers-lead-identities.json'),transactionHtml:table};
const r=extractChargersEvents(html,options);assert.deepEqual(r.unresolved,[]);assert.equal(r.events.length,5);
for(const e of r.events){assert.equal(e.reportedAt,e.name==='Rashawn Slater'?'2026-10-09':'2026-10-10');assert.equal(e.publishedAt,'2026-10-03T20:10:00Z');assert.equal(e.effectiveDateSourceUrl,'https://www.chargers.com/team/transactions/2026');}
assert.ok(extractChargersEvents(html,{...options,transactionHtml:table.replace('Scott Matlock','Unknown Player')}).unresolved.some(e=>e.name==='Scott Matlock'));
assert.ok(extractChargersEvents(html,{...options,transactionHtml:table.replace('10/10','10/11')}).unresolved.length);
console.log('PASS: five effective dates from official rows, original publication retained, missing or out-of-range corroboration blocked.');
