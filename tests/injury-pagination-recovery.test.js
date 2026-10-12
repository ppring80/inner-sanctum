'use strict';
const assert=require('assert');
const {collectPages}=require('../netlify/functions/_official-transaction-pages');
const {recover}=require('../scripts/refresh-injury-evidence-workflow');
const source={year:2026,month:10,category:'reserve-list',url:'https://www.nfl.com/transactions/league/reserve-list/2026/10'};
const table=name=>'<table><tr><th>From</th><th>To</th><th>Date</th><th>Name</th><th>Position</th><th>Transaction</th></tr><tr><td></td><td><a href="/teams/new-york-giants/">NYG</a></td><td>10/01</td><td>'+name+'</td><td>WR</td><td>Reserve/Injured</td></tr></table>';
const next='<a class="nfl-o-table-pagination__next" href="'+source.url+'?after=abc=">Next</a>';
(async()=>{
 let calls=0;const headers=[];
 const rows=await collectPages(source,{fetchImpl:async(url,o)=>{calls++;headers.push(o.headers);return {ok:true,text:async()=>calls<3?table('First Player')+next:table('Second Player')};}});
 assert.equal(calls,3);assert.equal(rows.length,2);assert.equal(headers[2]['Cache-Control'],'no-cache');
 calls=0;await assert.rejects(()=>collectPages(source,{fetchImpl:async()=>{calls++;return {ok:true,text:async()=>table('Same Player')+next};}}),/pagination loop/);assert.equal(calls,4,'one first page plus at most three attempts at the repeated next page');
 await assert.rejects(()=>collectPages(source,{fetchImpl:async()=>({ok:true,text:async()=>table('Player')+next.replace('www.nfl.com','evil.invalid')})}),/contract changed/);
 const sequence=[{status:202,ok:true},{status:200,ok:true},{status:200,ok:true,json:async()=>({injuryTransactions:{fresh:false}})},{status:200,ok:true},{status:200,ok:true,json:async()=>({injuryTransactions:{fresh:true,checkedAt:'verified',health:{error:null}}})}];
 let waits=0;const recovered=await recover({token:'fixture',attempts:3,wait:async()=>waits++,fetchImpl:async()=>sequence.shift()});assert.equal(recovered.checkedAt,'verified');assert.equal(waits,2);
 await assert.rejects(()=>recover({token:'fixture',attempts:2,wait:async()=>{},fetchImpl:async url=>url.includes('weekly-sage-status')?{status:200,ok:true,json:async()=>({injuryTransactions:{fresh:true,health:{error:'collector failed'}}})}:{status:200,ok:true}}),/verified fresh evidence/);
 console.log('PASS: bounded repeated-page recovery, persistent loop rejection, same-source URLs, 202/stale/error cannot claim freshness.');
})().catch(e=>{console.error(e);process.exitCode=1});
