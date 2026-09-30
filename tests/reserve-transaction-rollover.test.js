'use strict';
const assert=require('assert');
const {reserveTransaction}=require('../netlify/functions/_reserve-transactions');
const {availabilityForPlayer}=require('../netlify/functions/weekly-sage-rb-availability');
const {applyCentralAvailability}=require('../netlify/functions/weekly-sage-rankings');
const player={playerID:'4702555',name:'Jonah Coleman',position:'RB',team:'DEN',status:'active'};
assert.equal(reserveTransaction(player,2026,2),null);
for(const week of [3,4,5]){
 assert.equal(availabilityForPlayer(player,2026,week).eligible,false,'IR survives weekly rollover');
 const positions={RB:[player,{name:'Unverified Back',position:'RB',status:'active'}]},inactive={};
 applyCentralAvailability(positions,inactive,{available:true,players:{},byName:new Map()},2026,week);
 assert(!positions.RB.some(x=>x.name===player.name),'missing provider player cannot clear a confirmed reserve transaction');
 assert.equal(inactive.RB[0].status,'IR');assert.equal(inactive.RB[0].eligibleForWeeklyRanking,false);
 assert.equal(positions.RB[0].availabilityVerified,false,'missing player is not verified healthy');
}
assert.equal(reserveTransaction(player,2025,4),null,'transaction is season-specific');
console.log('Confirmed IR persists across rollover and missing provider rows cannot prove health.');
