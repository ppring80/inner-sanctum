'use strict';
const assert=require('node:assert/strict');
const {availabilityForPlayer}=require('../netlify/functions/weekly-sage-rb-availability');
const player={playerID:'4702555',name:'Jonah Coleman',position:'RB',team:'DEN'};
const cache={availabilityMode:'tank01-full-player-list-v1',updatedAt:new Date().toISOString(),players:{'4702555':{longName:'Jonah Coleman',pos:'RB',team:'DEN',injury:{designation:''}}}};
assert.equal(availabilityForPlayer(player,2026,6).eligible,false,'historical legacy reserve fixture remains available without a current source');
assert.equal(availabilityForPlayer(player,2026,6,cache).eligible,true,'current provider status supersedes a static reserve seed');
cache.players['4702555'].injury.designation='IR';assert.equal(availabilityForPlayer(player,2026,6,cache).eligible,false);
cache.players['4702555'].injury.designation='Out';assert.equal(availabilityForPlayer(player,2026,6,cache).eligible,false);
cache.players['4702555'].rosterStatus='UNSIGNED';assert.equal(availabilityForPlayer(player,2026,6,cache).status,'UNSIGNED');
console.log('PASS RB builder current provider status supersedes old reserve seeds; IR, Out and departures remain unavailable.');
// The real production loader must never read retired sources, including on a
// provider-cache failure (otherwise an old reserve seed can reappear).
(async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const req=require('node:module').createRequire(path.resolve(__dirname,'../netlify/functions/weekly-sage-rankings.js'));
 const reads=[];let fail=false;
 const sandbox={exports:{},console,process,URL,require:id=>id==='@netlify/blobs'?{connectLambda(){},getStore:({name})=>({get:async()=>{reads.push(name);if(fail&&name==='player-data')throw Error('fixture cache outage');return name==='player-data'?cache:null;}})}:req(id)};
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../netlify/functions/weekly-sage-rankings.js'),'utf8')+'\nexports.loadForTest=loadCentralAvailability;',sandbox);
 let result=await sandbox.exports.loadForTest();assert.equal(result.providerAvailability,true);assert.equal(result.transactions.length,0);assert(!reads.some(n=>/injury-transactions|official-club/.test(n)));
 fail=true;result=await sandbox.exports.loadForTest();assert.equal(result.providerAvailability,true);assert.equal(result.transactions.length,0,'cache outage cannot restore an obsolete reserve seed');
 console.log('PASS live availability loader never consults retired sources, including provider-cache failure.');
})().catch(e=>{console.error(e);process.exitCode=1;});
