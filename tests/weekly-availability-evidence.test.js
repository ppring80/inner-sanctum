'use strict';
const assert=require('assert');
const {applyCentralAvailability}=require('../netlify/functions/weekly-sage-rankings');
function run(players,byName=new Map(),fresh=true,row={playerID:'p1',name:'Test Player',position:'RB',team:'AAA'}){
 const positions={RB:[row]},inactive={};applyCentralAvailability(positions,inactive,{players,byName,fresh,available:true},2024,7);return {rows:positions.RB,inactive:inactive.RB};
}
const player={longName:'Test Player',pos:'RB',team:'AAA'};
for(const status of ['OUT','IR','PUP','SUSPENDED','UNSIGNED','RELEASED','WAIVED','CUT']){
 const result=run({p1:{...player,injury:{designation:'Questionable'},rosterStatus:status}});
 assert.equal(result.rows.length,0,status+' must outrank a softer injury label');assert.equal(result.inactive[0].status,status);
}
assert.equal(run({p1:{...player,active:false}}).rows.length,0);
assert.equal(run({p1:player},new Map(),false).rows[0].availabilityVerified,false,'stale evidence cannot verify availability');
assert.equal(run({p1:player}).rows[0].availabilityVerified,true);
for(const status of ['Questionable','Doubtful']){
 const result=run({p1:{...player,injury:{designation:status}}});assert.equal(result.rows.length,1);assert.equal(result.rows[0].injuryStatus,status.toUpperCase());
}
assert.equal(run({},new Map([['testplayer',[{...player,pos:'WR',injury:{designation:'Out'}}]]])).rows[0].availabilityVerified,false);
assert.equal(run({},new Map([['testplayer',[{...player,team:'BBB',injury:{designation:'Out'}}]]])).rows[0].availabilityVerified,false);
assert.equal(run({},new Map([['testplayer',[player,{...player}]]])).rows[0].availabilityVerified,false);
assert.equal(run({},new Map([['testplayer',[{...player,injury:{designation:'Out'}}]]])).rows.length,0);
assert.equal(run({p1:{...player,pos:'WR',injury:{designation:'Out'}}}).rows[0].availabilityVerified,false);
for(const pos of ['qb','rb','wr','te']){
 const {availabilityForPlayer}=require('../netlify/functions/weekly-sage-'+pos+'-availability');
 for(const status of ['OUT','IR','PUP','SUSPENDED','UNSIGNED'])assert.equal(availabilityForPlayer({name:'Test Player',team:'ZZ',injuryStatus:'Questionable',rosterStatus:status,eligible:true},2024,7).eligible,false,pos+' '+status);
 assert.equal(availabilityForPlayer({name:'Test Player',injuryStatus:'Questionable'},2024,7).eligible,true);
}
console.log('Authoritative unavailability, freshness and identity regression checks passed.');
