'use strict';
const assert=require('node:assert/strict');
const {rosterSnapshot}=require('../netlify/functions/_club-availability-reconciliation');
const {currentClubAvailability}=require('../netlify/functions/_current-club-availability');
const section=(title,name)=>`<h4 class="nfl-o-roster__title"><span class="nfl-o-roster__title-status">${title}</span></h4><table><tr><th>Player</th><th>Pos</th></tr><tr><td><a href="/team/players-roster/${name.toLowerCase()}/" title="${name}">${name}</a></td><td>TE</td></tr></table>`;
const asOf='2026-10-14T20:00:00Z',sourceUrl='https://www.clevelandbrowns.com/team/players-roster/';
for(const [label,status] of [['Reserve/Non-Football Illness','NFI'],['Reserve/Suspended by Commissioner','SUSPENDED'],['Reserve/Retired','RETIRED'],['Reserve/Unrecognized','UNKNOWN']]){
 const snapshot=rosterSnapshot(section('Active','Starter')+section(label,'Reserve'),{team:'CLE',sourceUrl,observedAt:asOf});
 const report=currentClubAvailability({team:'CLE',season:2026,asOf,snapshot});
 const player=report.players.find(p=>p.name==='Reserve');
 assert.equal(player.status,status);
 assert.equal(report.collectionHealthy,status!=='UNKNOWN');
 assert.equal(report.discoveryComplete,false);
 assert.equal(player.customerEligible,false);
 if(['SUSPENDED','RETIRED'].includes(status)){
  const prior={name:'Reserve',team:'CLE',season:2026,status:'IR',reportedAt:'2026-10-01'};
  const conflict=currentClubAvailability({team:'CLE',season:2026,asOf,snapshot,previousRecords:[prior]}).players.find(p=>p.name==='Reserve');
  assert.equal(conflict.lastVerifiedStatus,'IR');assert.ok(conflict.conflicts.includes('ROSTER_TRANSACTION_CONFLICT'));
 }
}
console.log('PASS: observed illness, suspension and retirement labels remain distinct; unknown labels and prior IR conflicts stay guarded.');
