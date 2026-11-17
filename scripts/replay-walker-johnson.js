'use strict';
const assert=require('node:assert/strict');
const {replayLeadBack}=require('./lib/late-rb-workload-replay');
// Pregame historical averages, not archived Tank01 projections.
// https://www.fantasypros.com/nfl/stats/emmett-johnson-kenneth-walker-rb.php
// https://www.reuters.com/sports/chiefs-rb-kenneth-walker-iii-downgraded-out-vs-falcons--flm-2026-11-14/
const event={season:2026,week:10,team:'KC',starterId:'walker',successorId:'johnson',status:'OUT',successorRole:'EXPECTED_LEAD',statusVerified:true,roleVerified:true,statusAt:'2026-11-14T23:42:49Z',roleAt:'2026-11-14T23:42:49Z',kickoff:'2026-11-15T18:00Z'};
const baseline={season:2026,week:10,team:'KC',asOf:'2026-11-14T12:00Z',starter:{id:'walker',carries:159/8,targets:36/8,goalLineCarries:0},successor:{id:'johnson',carries:26/8,targets:16/8,goalLineCarries:0}};
const run=(e=event,asOf='2026-11-15T00:00Z')=>replayLeadBack({event:e,baseline,asOf});
const r=run();
assert(r.applied);
for(const delta of [{status:'QUESTIONABLE'},{roleVerified:false},{team:'ATL'}]) assert.equal(run({...event,...delta}).applied,false);
assert.equal(run(event,event.kickoff).applied,false);
// Goal-line work is unknown. Score yardage and receptions only, with illustrative receiving assumptions.
for(const share of [0,0.5,0.75,1]){
 const carries=r.before.carries+share*(r.workload.carries-r.before.carries);
 const targets=r.before.targets+share*(r.workload.targets-r.before.targets);
 const catches=targets*0.75;
 console.log({share,carries,targets,halfPprBeforeTd:Number(((carries*111/26+catches*7)/10+catches/2).toFixed(1))});
}
