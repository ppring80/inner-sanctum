'use strict';
const assert=require('node:assert/strict'),clubs=require('../netlify/functions/_official-club-sources.json');
const {observationStatus}=require('../netlify/functions/_club-observation-status');
const now=Date.parse('2026-10-14T04:00:00Z');
function report(club){const observedAt='2026-10-14T03:50:00Z';return {team:club.team,season:2026,asOf:'2026-10-14T03:55:00Z',collectionHealthy:true,discoveryComplete:false,players:[{name:'Observed Player',team:club.team,position:'RB',status:'IR',lastVerifiedStatus:'IR',observedAt,placementDate:null,conflicts:[],provenance:[{sourceUrl:club.origin+'/team/players-roster/',profileUrl:club.origin+'/team/players-roster/observed-player/',observedAt,status:'IR'}]}]};}
assert.equal(observationStatus(null,{now}).freshTeams.length,0);
const cache={teams:Object.fromEntries(clubs.map(club=>[club.team,report(club)]))};
const original=JSON.stringify(cache),good=observationStatus(cache,{now});
assert.equal(good.freshRosterCoverage,true);assert.equal(good.freshTeams.length,32);assert.equal(good.establishesAnnouncementCoverage,false);
assert.equal(JSON.stringify(cache),original,'Read-only status does not mutate saved evidence');
assert.equal(good.oldestObservedAt,'2026-10-14T03:50:00.000Z');assert.equal(good.teams[0].counts.IR,1);
cache.teams[clubs[0].team].players[0].conflicts=['ACTIVE_LISTING_DOES_NOT_CLEAR_RESERVE_OR_DEPARTURE'];
const conflict=observationStatus(cache,{now});assert.equal(conflict.playerConflictCount,1);assert.equal(conflict.teams[0].playerConflicts[0].name,'Observed Player');assert.equal(conflict.teams[0].counts.IR,0);
assert.equal(conflict.freshRosterCoverage,true,'Fresh collection is reported separately from player discrepancies');
cache.teams[clubs[1].team].players[0].observedAt='2026-10-14T01:00:00Z';
assert.equal(observationStatus(cache,{now}).freshRosterCoverage,false,'A recent report cannot hide a stale underlying observation');
cache.teams[clubs[1].team].asOf='2026-10-14T05:00:00Z';assert.equal(observationStatus(cache,{now}).teams[1].fresh,false);
cache.teams[clubs[2].team].season=2025;assert.equal(observationStatus(cache,{now}).teams[2].fresh,false,'Wrong-season evidence is not fresh');
console.log('PASS: read-only roster coverage visibility, original observation age, named conflicts, reserve counts and independent announcement coverage.');
