'use strict';
const assert = require('node:assert/strict');
const {validateClaims} = require('../netlify/functions/_super-sage-rookie-claim-checks');
const {validateBackfieldCoverage} = require('../netlify/functions/_super-sage-rookie-backfield-checks');
const packet = {players:[{name:'Will Shipley',facts:[{field:'backfieldContext',factId:'B:backfieldContext',value:{reportedRoles:{players:[{name:'Saquon Barkley',status:'OUT',listedRank:1},{name:'Tank Bigsby',status:'IR',listedRank:2}],notListedInChart:['Dameon Pierce','Jaydon Blue']}}}]}]};
assert(!validateClaims({explanation:"Corum has a healthier recent baseline than Shipley."},packet).includes('availability_overstated_as_health'));
assert(validateClaims({explanation:"Corum is healthier than Shipley."},packet).includes('availability_overstated_as_health'));
assert(validateClaims({explanation:"Corum has a healthier recent baseline and Shipley is healthier."},packet).includes('availability_overstated_as_health'));
assert(validateClaims({explanation:"Two Philadelphia starters being out gives Shipley a chance."},packet).includes('unsupported_backfield_starter_claim'));
assert(!validateClaims({explanation:"Barkley is OUT and Bigsby is on IR; two absent backs could mean more work for Shipley."},packet).includes('unsupported_backfield_starter_claim'));
for(const phrase of ["Dameon Pierce and Jaydon Blue don't appear on the Eagles' chart", "Dameon Pierce and Jaydon Blue do not appear on the chart", "Dameon Pierce and Jaydon Blue are absent from the chart"]) {
 assert(!validateBackfieldCoverage({explanation:phrase,factIds:['B:backfieldContext']},packet).includes('missing_uncharted_alternative'));
}
assert(validateBackfieldCoverage({explanation:'Dameon Pierce and Jaydon Blue could get carries.',factIds:['B:backfieldContext']},packet).includes('missing_uncharted_alternative'));
console.log('Role claims: non-health baseline wording and explicit chart absence accepted; real health overstatement, unsupported two starters and missing absence rejected. No provider calls.');

const threeBacks=JSON.parse(JSON.stringify(packet));
threeBacks.players[0].facts[0].value.reportedRoles.notListedInChart.push('Carson Steele');
const savedSentence="Shipley's tougher matchup and the unverified workload split among Dameon Pierce, Jaydon Blue, and Carson Steele — none of whom appear on the team-published chart — are real risks, but the team's own lead-back expectation tips the edge his way.";
const coverage=text=>validateBackfieldCoverage({explanation:text,factIds:['B:backfieldContext']},threeBacks);
assert(!coverage(savedSentence).includes('missing_uncharted_alternative'));
assert(!coverage(savedSentence.replace('none of whom','none of them')).includes('missing_uncharted_alternative'));
assert(coverage(savedSentence.replace(', and Carson Steele','')).includes('missing_uncharted_alternative'));
assert(coverage(savedSentence.replace('none of whom appear','all of whom appear')).includes('missing_uncharted_alternative'));
assert(coverage(savedSentence.replace('none of whom appear on the team-published chart','whose roles are uncertain')).includes('missing_uncharted_alternative'));
