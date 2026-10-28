'use strict';
const assert=require('node:assert/strict');
const {verifyRankedAvailability}=require('../scripts/verify-weekly-tools');
const {buildPlayerCache}=require('../netlify/functions/_tank01-player-cache');
const history=require('../netlify/functions/_reserve-transactions').TRANSACTIONS;
const historyBefore=JSON.stringify(history);
const now=Date.parse('2026-10-28T02:00:00Z');
const row={name:'Fixture Runner',playerID:'test-0',position:'RB',team:'DEN'};
function cache(injury={designation:''},extra={}){
 const players=Array.from({length:1100},(_,i)=>({playerID:'test-'+i,longName:i?'Fixture Player '+i:row.name,pos:'RB',team:i?'T'+i%32:'DEN',injury:{designation:''}}));
 // Exactly 32 synthetic team identifiers including DEN, no private league input.
 for(let i=1;i<players.length;i++)players[i].team=i%32===0?'DEN':'T'+i%32;
 players[0]={...players[0],injury,...extra};
 return buildPlayerCache(players,new Date(now-60000).toISOString());
}
const positions={RB:[row]};
for(const designation of ['Injured Reserve','Injured Reserve - Designated to Return','PUP','Reserve/PUP','NFI','OUT']){
 assert.throws(()=>verifyRankedAvailability(positions,cache({designation}),now),/restriction appears/,'Placement and practice-window designation remain unavailable');
}
const active=cache({designation:''},{active:true,rosterStatus:'ACTIVE'});
assert.equal(verifyRankedAvailability(positions,active,now).explicitlyActive,1,'Explicit activation/current active state passes');
assert.throws(()=>verifyRankedAvailability(positions,cache({designation:'IR'}),now),/restriction appears/,'Renewed restriction is enforced after activation');
const cleared=verifyRankedAvailability(positions,cache(),now);
assert.equal(cleared.noRestrictionReported,1);
assert.equal(cleared.explicitlyActive,0,'Blank injury field never becomes confirmed activation');
assert.throws(()=>verifyRankedAvailability(positions,{...active,updatedAt:new Date(now-9*3600000).toISOString()},now),/stale/);
assert.throws(()=>verifyRankedAvailability(positions,{...active,updatedAt:new Date(now+60000).toISOString()},now),/stale/);
for(const patch of [{playerID:'missing'},{name:'Different Runner'},{team:'SEA'},{position:'WR'}]){
 const input=patch.position?{WR:[{...row,...patch}]}:{RB:[{...row,...patch}]};
 assert.throws(()=>verifyRankedAvailability(input,active,now),/identity (missing|mismatch)/);
}
assert.throws(()=>verifyRankedAvailability(positions,cache({designation:'Questionable'},{rosterStatus:'IR'}),now),/restriction appears/,'A softer injury label cannot hide a reserve restriction');
assert.throws(()=>verifyRankedAvailability(positions,cache({}, {active:false}),now),/restriction appears/);
assert.throws(()=>verifyRankedAvailability(positions,cache({}, {isFreeAgent:'True'}),now),/identity mismatch|restriction appears/);
const kicker=cache();kicker.players['test-0'].pos='PK';
assert.equal(verifyRankedAvailability({K:[{...row,position:'K'}]},kicker,now).rankedPlayersChecked,1,'Shared K/PK normalization is retained');

// Public identity regression; empty current designation is not an activation assertion.
const coleman={name:'Jonah Coleman',playerID:'4702555',position:'RB',team:'DEN'};
const current=cache();delete current.players['test-0'];
current.players[coleman.playerID]={longName:coleman.name,pos:'RB',team:'DEN',injury:{designation:''}};
assert(history.some(t=>t.playerID===coleman.playerID&&t.status==='IR'));
assert.equal(verifyRankedAvailability({RB:[coleman]},current,now).rankedPlayersChecked,1,'An old static IR entry cannot override current identity-matched evidence');
assert.throws(()=>verifyRankedAvailability({RB:[coleman]},{...current,players:{...current.players,[coleman.playerID]:{...current.players[coleman.playerID],injury:{designation:'IR'}}}},now),/restriction appears/);
assert.equal(JSON.stringify(history),historyBefore,'Historical reserve records remain unchanged');
console.log('PASS: current availability audit, reserve/practice/activation/restriction lifecycle, blank versus activation, stale/identity rejection and preserved historical IR.');
